//! The query engine: runs a saved question ("every document tagged NPC whose Status is Alive")
//! against a project.
//!
//! The shape of a query, and what it means, is defined in TypeScript (`src/lib/queries/query.ts`);
//! this module reads the same JSON, checks it again (a stored query can come from a content pack),
//! and turns it into one parameterized SQL statement. Rules that hold for both sides:
//!  - an **incomplete** rule (nothing chosen yet, empty text) and an **empty group** are ignored;
//!  - a rule naming a tag, folder or field that was deleted (or a test that doesn't suit the
//!    field's kind) matches nothing, and "not" of it matches everything;
//!  - trashed items and documents that live inside another page's tabs are never in the answer.
//! Text tests ignore case (all of Unicode, through the `tt_fold` function registered on every
//! connection). No value is ever pasted into the SQL text; everything the person typed is a parameter.
//!
//! The tests compare this module with a slow, obviously-correct evaluator (`query_tests.rs`) over
//! thousands of random queries on random projects, so the SQL can't quietly disagree with the meaning.

use super::error::DbError;
use super::items::{self, Item};
use rusqlite::functions::FunctionFlags;
use rusqlite::types::Value;
use rusqlite::{params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const VERSION: u32 = 1;
pub const MAX_DEPTH: usize = 4;
pub const MAX_NODES: usize = 100;
pub const MAX_TEXT_CHARS: usize = 200;
pub const MAX_IDS: usize = 50;
pub const MAX_DAYS: i64 = 3650;
pub const MAX_SORT_KEYS: usize = 3;
pub const MAX_COLUMNS: usize = 12;
const MAX_VIEW_BYTES: usize = 20_000;
/// The most items one answer holds; `truncated` says when there were more.
pub const MAX_RESULTS: usize = 5000;

const DAY_MS: i64 = 86_400_000;

// ---------------------------------------------------------------- the shape

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Query {
    pub version: u32,
    #[serde(rename = "where")]
    pub where_: Group,
    #[serde(default)]
    pub sort: Vec<SortKey>,
    /// How a smart collection is shown (list or table, and the table's columns). The engine ignores
    /// it; it travels with the query so it is saved, packed and remapped with it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Op {
    All,
    Any,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Group {
    pub op: Op,
    #[serde(default)]
    pub not: bool,
    #[serde(default)]
    pub rules: Vec<Node>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Node {
    Group(Group),
    Rule(Rule),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Rule {
    #[serde(default)]
    pub not: bool,
    #[serde(flatten)]
    pub body: RuleBody,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RuleBody {
    ItemType { types: Vec<String> },
    Library { libraries: Vec<String> },
    Folder { folder_id: String, subfolders: bool },
    Tag { tag_id: String, subtags: bool },
    Name { text: String },
    Text { text: String },
    Field { field_id: String, test: FieldTest },
    LinksTo { item_id: String },
    LinkedFrom { item_id: String },
    Changed { days: i64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum Cmp {
    #[serde(rename = "=")]
    Eq,
    #[serde(rename = "<")]
    Lt,
    #[serde(rename = "<=")]
    Le,
    #[serde(rename = ">")]
    Gt,
    #[serde(rename = ">=")]
    Ge,
}

impl Cmp {
    fn sql(self) -> &'static str {
        match self {
            Cmp::Eq => "=",
            Cmp::Lt => "<",
            Cmp::Le => "<=",
            Cmp::Gt => ">",
            Cmp::Ge => ">=",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "check", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FieldTest {
    Contains { text: String },
    Equals { text: String },
    Number { cmp: Cmp, value: f64 },
    Between { min: f64, max: f64 },
    Choice { option_ids: Vec<String> },
    Links { item_id: String },
    Empty,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Dir {
    #[default]
    Asc,
    Desc,
}

impl Dir {
    fn sql(self) -> &'static str {
        match self {
            Dir::Asc => "ASC",
            Dir::Desc => "DESC",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "by", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SortKey {
    Name { #[serde(default)] dir: Dir },
    Created { #[serde(default)] dir: Dir },
    Updated { #[serde(default)] dir: Dir },
    Type { #[serde(default)] dir: Dir },
    Field { field_id: String, #[serde(default)] dir: Dir },
}

/// The kinds of field a test suits (same table as `testsForKind` in TypeScript).
pub fn test_suits_kind(test: &FieldTest, kind: &str) -> bool {
    match test {
        FieldTest::Contains { .. } => matches!(kind, "text" | "formula" | "list"),
        FieldTest::Equals { .. } => matches!(kind, "text" | "formula"),
        FieldTest::Number { .. } | FieldTest::Between { .. } => matches!(kind, "number" | "bar" | "date"),
        FieldTest::Choice { .. } => kind == "dropdown",
        FieldTest::Links { .. } => kind == "link",
        FieldTest::Empty => true,
    }
}

// ---------------------------------------------------------------- reading and checking

/// Whether a rule has what it needs to run (the same test as `isRuleComplete` in TypeScript).
pub fn is_complete(rule: &Rule) -> bool {
    match &rule.body {
        RuleBody::ItemType { types } => !types.is_empty(),
        RuleBody::Library { libraries } => !libraries.is_empty(),
        RuleBody::Folder { folder_id, .. } => !folder_id.is_empty(),
        RuleBody::Tag { tag_id, .. } => !tag_id.is_empty(),
        RuleBody::Name { text } | RuleBody::Text { text } => !text.trim().is_empty(),
        RuleBody::LinksTo { item_id } | RuleBody::LinkedFrom { item_id } => !item_id.is_empty(),
        RuleBody::Changed { days } => *days >= 1,
        RuleBody::Field { field_id, test } => {
            !field_id.is_empty()
                && match test {
                    FieldTest::Contains { text } | FieldTest::Equals { text } => !text.trim().is_empty(),
                    FieldTest::Choice { option_ids } => !option_ids.is_empty(),
                    FieldTest::Links { item_id } => !item_id.is_empty(),
                    _ => true,
                }
        }
    }
}

/// Reads a stored query. A query from a newer app, or one that isn't a query, is refused with a sentence.
pub fn parse(json: &str) -> Result<Query, DbError> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| DbError::Invalid("This isn't a valid query."))?;
    from_value(value)
}

pub fn from_value(value: serde_json::Value) -> Result<Query, DbError> {
    if value.get("version").and_then(|v| v.as_u64()).is_some_and(|v| v > VERSION as u64) {
        return Err(DbError::Invalid("This query was made by a newer version of the app."));
    }
    let query: Query = serde_json::from_value(value).map_err(|_| DbError::Invalid("This isn't a valid query."))?;
    validate(&query)?;
    Ok(query)
}

fn check_text(text: &str) -> Result<(), DbError> {
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(DbError::Invalid("A rule in this query has text that is too long."));
    }
    Ok(())
}

fn check_list(list: &[String]) -> Result<(), DbError> {
    if list.len() > MAX_IDS {
        return Err(DbError::Invalid("A rule in this query has too long a list."));
    }
    list.iter().try_for_each(|s| check_text(s))
}

/// Everything the database relies on: version, sizes, depth, finite numbers.
pub fn validate(query: &Query) -> Result<(), DbError> {
    if query.version != VERSION {
        return Err(DbError::Invalid("This isn't a valid query."));
    }
    if query.sort.len() > MAX_SORT_KEYS {
        return Err(DbError::Invalid("This query sorts by too many things."));
    }
    for key in &query.sort {
        if let SortKey::Field { field_id, .. } = key {
            check_text(field_id)?;
        }
    }
    if let Some(view) = &query.view {
        let columns_ok = view.get("columns").is_none_or(|c| c.as_array().is_some_and(|a| a.len() <= MAX_COLUMNS));
        if !view.is_object() || !columns_ok || view.to_string().len() > MAX_VIEW_BYTES {
            return Err(DbError::Invalid("This query's table settings can't be used."));
        }
    }
    let mut count = 0;
    validate_group(&query.where_, 1, &mut count)
}

fn validate_group(group: &Group, depth: usize, count: &mut usize) -> Result<(), DbError> {
    if depth > MAX_DEPTH {
        return Err(DbError::Invalid("This query has groups nested too deeply."));
    }
    for node in &group.rules {
        *count += 1;
        if *count > MAX_NODES {
            return Err(DbError::Invalid("This query has too many rules."));
        }
        match node {
            Node::Group(g) => validate_group(g, depth + 1, count)?,
            Node::Rule(r) => validate_rule(r)?,
        }
    }
    Ok(())
}

fn validate_rule(rule: &Rule) -> Result<(), DbError> {
    match &rule.body {
        RuleBody::ItemType { types } => check_list(types),
        RuleBody::Library { libraries } => check_list(libraries),
        RuleBody::Folder { folder_id: id, .. } | RuleBody::Tag { tag_id: id, .. } => check_text(id),
        RuleBody::Name { text } | RuleBody::Text { text } => check_text(text),
        RuleBody::LinksTo { item_id } | RuleBody::LinkedFrom { item_id } => check_text(item_id),
        RuleBody::Changed { days } => {
            if (1..=MAX_DAYS).contains(days) {
                Ok(())
            } else {
                Err(DbError::Invalid("The number of days in this query is out of range."))
            }
        }
        RuleBody::Field { field_id, test } => {
            check_text(field_id)?;
            match test {
                FieldTest::Contains { text } | FieldTest::Equals { text } => check_text(text),
                FieldTest::Number { value, .. } if !value.is_finite() => Err(DbError::Invalid("A number in this query isn't a number.")),
                FieldTest::Between { min, max } if !min.is_finite() || !max.is_finite() => Err(DbError::Invalid("A number in this query isn't a number.")),
                FieldTest::Choice { option_ids } => check_list(option_ids),
                FieldTest::Links { item_id } => check_text(item_id),
                _ => Ok(()),
            }
        }
    }
}

// ---------------------------------------------------------------- text folding

/// Lower-cases text for comparing ("Ash" matches "ash", "É" matches "é").
pub fn fold(text: &str) -> String {
    text.to_lowercase()
}

/// The form a typed piece of text takes before it is compared: trimmed, then folded.
pub fn fold_trim(text: &str) -> String {
    text.trim().to_lowercase()
}

/// Registers the SQL functions queries use on a connection (every connection gets them, real or test).
pub fn register_functions(conn: &Connection) -> rusqlite::Result<()> {
    let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
    conn.create_scalar_function("tt_fold", 1, flags, |ctx| {
        let text: Option<String> = ctx.get(0)?;
        Ok(text.map(|t| fold(&t)).unwrap_or_default())
    })?;
    conn.create_scalar_function("tt_fold_trim", 1, flags, |ctx| {
        let text: Option<String> = ctx.get(0)?;
        Ok(text.map(|t| fold_trim(&t)).unwrap_or_default())
    })?;
    Ok(())
}

// ---------------------------------------------------------------- turning a query into SQL

struct Builder<'a> {
    conn: &'a Connection,
    project_id: &'a str,
    now: i64,
    params: Vec<Value>,
}

impl Builder<'_> {
    /// Adds a parameter and returns its placeholder.
    fn param(&mut self, value: impl Into<Value>) -> &'static str {
        self.params.push(value.into());
        "?"
    }

    /// Adds a list of parameters and returns `?, ?, ?`.
    fn list(&mut self, values: &[String]) -> String {
        values.iter().map(|v| {
            self.params.push(Value::Text(v.clone()));
            "?"
        }).collect::<Vec<_>>().join(", ")
    }

    fn field_kind(&self, field_id: &str) -> Result<Option<String>, DbError> {
        Ok(self
            .conn
            .query_row(
                "SELECT kind FROM field_definitions WHERE id = ?1 AND project_id = ?2 AND deleted_at IS NULL",
                [field_id, self.project_id],
                |r| r.get(0),
            )
            .optional()?)
    }

    fn group(&mut self, group: &Group) -> Result<Option<String>, DbError> {
        let mut parts = Vec::new();
        for node in &group.rules {
            let part = match node {
                Node::Group(g) => self.group(g)?,
                Node::Rule(r) => self.rule(r)?,
            };
            parts.extend(part);
        }
        if parts.is_empty() {
            return Ok(None);
        }
        let joined = parts.join(if group.op == Op::All { " AND " } else { " OR " });
        Ok(Some(if group.not { format!("NOT ({joined})") } else { format!("({joined})") }))
    }

    fn rule(&mut self, rule: &Rule) -> Result<Option<String>, DbError> {
        if !is_complete(rule) {
            return Ok(None);
        }
        let expr = self.body(&rule.body)?;
        Ok(Some(if rule.not { format!("NOT ({expr})") } else { format!("({expr})") }))
    }

    /// The condition for one rule. It is always true or false, never NULL, so "NOT" is safe.
    fn body(&mut self, body: &RuleBody) -> Result<String, DbError> {
        Ok(match body {
            RuleBody::ItemType { types } => format!("i.item_type IN ({})", self.list(types)),
            RuleBody::Library { libraries } => format!("i.library IN ({})", self.list(libraries)),
            RuleBody::Folder { folder_id, subfolders } => {
                let ph = self.param(folder_id.clone());
                if *subfolders {
                    format!(
                        "COALESCE(i.folder_id IN (WITH RECURSIVE sub(id) AS (
                            SELECT id FROM folders WHERE id = {ph} AND deleted_at IS NULL
                            UNION
                            SELECT f.id FROM folders f JOIN sub s ON f.parent_id = s.id WHERE f.deleted_at IS NULL
                         ) SELECT id FROM sub), 0)"
                    )
                } else {
                    format!("COALESCE(i.folder_id IN (SELECT id FROM folders WHERE id = {ph} AND deleted_at IS NULL), 0)")
                }
            }
            RuleBody::Tag { tag_id, subtags } => {
                let ph = self.param(tag_id.clone());
                let tags = if *subtags {
                    format!(
                        "WITH RECURSIVE sub(id) AS (
                            SELECT id FROM tags WHERE id = {ph} AND deleted_at IS NULL
                            UNION
                            SELECT t.id FROM tags t JOIN sub s ON t.parent_id = s.id WHERE t.deleted_at IS NULL
                         ) SELECT id FROM sub"
                    )
                } else {
                    format!("SELECT id FROM tags WHERE id = {ph} AND deleted_at IS NULL")
                };
                format!("EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = i.id AND it.deleted_at IS NULL AND it.tag_id IN ({tags}))")
            }
            RuleBody::Name { text } => {
                let ph = self.param(fold_trim(text));
                format!("instr(tt_fold(i.name), {ph}) > 0")
            }
            RuleBody::Text { text } => {
                let needle = fold_trim(text);
                let a = self.param(needle.clone());
                let b = self.param(needle.clone());
                let c = self.param(needle);
                format!(
                    "(instr(tt_fold(i.name), {a}) > 0
                      OR EXISTS (SELECT 1 FROM document_content d WHERE d.item_id = i.id AND instr(tt_fold(d.body), {b}) > 0)
                      OR EXISTS (SELECT 1 FROM field_values v JOIN field_definitions fd ON fd.id = v.field_id AND fd.deleted_at IS NULL
                                 WHERE v.item_id = i.id AND v.deleted_at IS NULL AND instr(tt_fold(v.search_text), {c}) > 0))"
                )
            }
            RuleBody::LinksTo { item_id } => {
                let ph = self.param(item_id.clone());
                format!(
                    "EXISTS (SELECT 1 FROM links l JOIN items t ON t.id = l.target_item_id
                             WHERE l.source_item_id = i.id AND l.target_item_id = {ph} AND l.deleted_at IS NULL AND t.deleted_at IS NULL)"
                )
            }
            RuleBody::LinkedFrom { item_id } => {
                let ph = self.param(item_id.clone());
                format!(
                    "EXISTS (SELECT 1 FROM links l JOIN items s ON s.id = l.source_item_id
                             WHERE l.target_item_id = i.id AND l.source_item_id = {ph} AND l.deleted_at IS NULL AND s.deleted_at IS NULL)"
                )
            }
            RuleBody::Changed { days } => {
                let ph = self.param(self.now - days * DAY_MS);
                format!("i.updated_at >= {ph}")
            }
            RuleBody::Field { field_id, test } => self.field(field_id, test)?,
        })
    }

    fn field(&mut self, field_id: &str, test: &FieldTest) -> Result<String, DbError> {
        let Some(kind) = self.field_kind(field_id)? else { return Ok("0".into()) };
        if !test_suits_kind(test, &kind) {
            return Ok("0".into());
        }
        // A link field's links are rows of the links table, kept in step by saving the field.
        if let FieldTest::Links { item_id } = test {
            let r = self.param(super::fields::link_ref(field_id));
            let t = self.param(item_id.clone());
            return Ok(format!(
                "EXISTS (SELECT 1 FROM links l JOIN items t ON t.id = l.target_item_id
                         WHERE l.source_item_id = i.id AND l.source_ref = {r} AND l.target_item_id = {t}
                           AND l.deleted_at IS NULL AND t.deleted_at IS NULL)"
            ));
        }
        let f = self.param(field_id.to_string());
        let has = |cond: String| format!("EXISTS (SELECT 1 FROM field_values v WHERE v.item_id = i.id AND v.field_id = {f} AND v.deleted_at IS NULL AND {cond})");
        Ok(match test {
            FieldTest::Contains { text } => {
                let ph = self.param(fold_trim(text));
                has(format!("instr(tt_fold(v.search_text), {ph}) > 0"))
            }
            FieldTest::Equals { text } => {
                let ph = self.param(fold_trim(text));
                has(format!("tt_fold_trim(v.search_text) = {ph}"))
            }
            FieldTest::Number { cmp, value } => {
                let ph = self.param(*value);
                has(format!("v.sort_num {} {ph}", cmp.sql()))
            }
            FieldTest::Between { min, max } => {
                let a = self.param(*min);
                let b = self.param(*max);
                has(format!("v.sort_num BETWEEN {a} AND {b}"))
            }
            FieldTest::Choice { option_ids } => {
                let list = self.list(option_ids);
                has(format!("json_extract(v.value_json, '$') IN ({list})"))
            }
            FieldTest::Empty => {
                let filled = match kind.as_str() {
                    "text" | "formula" => "json_extract(v.value_json, '$') <> ''",
                    "number" | "bar" | "dropdown" | "date" => "json_extract(v.value_json, '$') IS NOT NULL",
                    _ => "json_array_length(v.value_json) > 0",
                };
                format!("NOT {}", has(filled.to_string()))
            }
            FieldTest::Links { .. } => unreachable!("handled above"),
        })
    }

    /// `ORDER BY` terms for the sort (the caller adds the final tie-breakers).
    fn order(&mut self, sort: &[SortKey]) -> Result<Vec<String>, DbError> {
        let mut terms = Vec::new();
        for key in sort {
            match key {
                SortKey::Name { dir } => terms.push(format!("i.name COLLATE NOCASE {}", dir.sql())),
                SortKey::Created { dir } => terms.push(format!("i.created_at {}", dir.sql())),
                SortKey::Updated { dir } => terms.push(format!("i.updated_at {}", dir.sql())),
                SortKey::Type { dir } => terms.push(format!("i.item_type {}", dir.sql())),
                SortKey::Field { field_id, dir } => {
                    let Some(kind) = self.field_kind(field_id)? else { continue };
                    // Items without a value come last whichever way the order runs.
                    let columns: &[&str] = match kind.as_str() {
                        "text" | "formula" => &["sort_text"],
                        "list" => &["sort_text", "sort_num"],
                        _ => &["sort_num"],
                    };
                    for column in columns {
                        let sub = |ph: &str| format!("(SELECT v.{column} FROM field_values v WHERE v.item_id = i.id AND v.field_id = {ph} AND v.deleted_at IS NULL)");
                        let first = self.param(field_id.clone());
                        let a = sub(first);
                        let second = self.param(field_id.clone());
                        let b = sub(second);
                        terms.push(format!("({a} IS NULL) ASC"));
                        terms.push(format!("{b} {}", dir.sql()));
                    }
                }
            }
        }
        Ok(terms)
    }
}

// ---------------------------------------------------------------- running

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub items: Vec<Item>,
    /// True when there were more matches than `MAX_RESULTS`.
    pub truncated: bool,
}

/// Runs a query against one project. `now` is the current time in milliseconds (for "changed in
/// the last N days"); `only_type` keeps only items of that type (a pool asks for cards).
pub fn run(conn: &Connection, project_id: &str, query: &Query, now: i64, only_type: Option<&str>) -> Result<QueryResult, DbError> {
    validate(query)?;
    let mut b = Builder { conn, project_id, now, params: vec![Value::Text(project_id.to_string())] };
    let mut sql = format!(
        "SELECT {} FROM items i
         WHERE i.project_id = ? AND i.deleted_at IS NULL
           AND i.id NOT IN (SELECT child_id FROM item_tabs WHERE child_id IS NOT NULL)",
        items::qualified_columns("i")
    );
    if let Some(item_type) = only_type {
        sql.push_str(" AND i.item_type = ?");
        b.params.push(Value::Text(item_type.to_string()));
    }
    if let Some(condition) = b.group(&query.where_)? {
        sql.push_str(" AND ");
        sql.push_str(&condition);
    }
    let mut order = b.order(&query.sort)?;
    order.push("i.name COLLATE NOCASE ASC".into());
    order.push("i.id ASC".into());
    sql.push_str(&format!(" ORDER BY {} LIMIT {}", order.join(", "), MAX_RESULTS + 1));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(b.params.iter()), items::from_row)?;
    let mut found = rows.collect::<Result<Vec<_>, _>>()?;
    let truncated = found.len() > MAX_RESULTS;
    found.truncate(MAX_RESULTS);
    Ok(QueryResult { items: found, truncated })
}

/// Reads a stored query and runs it.
pub fn run_json(conn: &Connection, project_id: &str, json: &str, now: i64, only_type: Option<&str>) -> Result<QueryResult, DbError> {
    run(conn, project_id, &parse(json)?, now, only_type)
}

#[cfg(test)]
#[path = "query_tests.rs"]
mod tests;
