use super::*;
use crate::db::fields::{self, ValueIndex};
use crate::db::{campaigns, documents, folders, items, links, open_in_memory, tabs, tags};
use serde_json::{json, Value as Json};
use std::collections::{HashMap, HashSet};

const NOW: i64 = 1_000_000_000_000;

// ---------------------------------------------------------------- a small world to ask questions of

struct Fx {
    conn: Connection,
    camp: String,
    clock: i64,
}

impl Fx {
    fn new() -> Fx {
        let conn = open_in_memory();
        let camp = campaigns::create(&conn, "Test", 1).unwrap().id;
        Fx { conn, camp, clock: 100 }
    }
    fn tick(&mut self) -> i64 {
        self.clock += 1;
        self.clock
    }
    fn item(&mut self, library: &str, kind: &str, name: &str) -> String {
        let now = self.tick();
        items::create(&self.conn, &self.camp, library, kind, name, None, now).unwrap().id
    }
    fn doc(&mut self, name: &str) -> String {
        self.item("worldbuilding", "document", name)
    }
    fn folder(&mut self, parent: Option<&str>, name: &str) -> String {
        let now = self.tick();
        folders::create(&self.conn, &self.camp, "worldbuilding", parent, name, now).unwrap().id
    }
    fn put_in(&mut self, item: &str, folder: &str) {
        let now = self.tick();
        items::move_to(&self.conn, item, Some(folder), now).unwrap();
    }
    fn tag(&mut self, parent: Option<&str>, name: &str) -> String {
        let now = self.tick();
        tags::create(&self.conn, &self.camp, parent, name, None, now).unwrap().id
    }
    fn tag_item(&mut self, item: &str, tag: &str) {
        let now = self.tick();
        tags::add_to_item(&self.conn, item, tag, now).unwrap();
    }
    fn field(&mut self, name: &str, kind: &str, config: &str) -> String {
        let now = self.tick();
        fields::create_definition(&self.conn, &self.camp, name, kind, "", config, now).unwrap().id
    }
    fn set(&mut self, item: &str, field: &str, value: Json, index: (Option<f64>, Option<&str>, &str)) {
        let now = self.tick();
        let index = ValueIndex { sort_num: index.0, sort_text: index.1.map(String::from), search_text: index.2.to_string() };
        fields::set_value(&self.conn, item, field, &value.to_string(), &index, false, now).unwrap();
    }
    fn set_text(&mut self, item: &str, field: &str, text: &str) {
        let lower = text.trim().to_lowercase();
        let sort = if lower.is_empty() { None } else { Some(lower.as_str()) };
        self.set(item, field, json!(text), (None, sort, if text.is_empty() { "" } else { text }));
    }
    fn set_number(&mut self, item: &str, field: &str, n: f64) {
        self.set(item, field, json!(n), (Some(n), None, &n.to_string()));
    }
    fn link(&mut self, from: &str, to: &str, source_ref: &str) {
        let now = self.tick();
        links::add(&self.conn, from, to, source_ref, now).unwrap();
    }
    fn run(&self, query: Json) -> Vec<String> {
        self.run_with(query, None)
    }
    fn run_with(&self, query: Json, only: Option<&str>) -> Vec<String> {
        let q = from_value(query).unwrap();
        run(&self.conn, &self.camp, &q, NOW, only).unwrap().items.into_iter().map(|i| i.name).collect()
    }
}

fn q(rules: Json) -> Json {
    json!({"version": 1, "where": {"op": "all", "not": false, "rules": rules}, "sort": [{"by": "name", "dir": "asc"}]})
}
fn q_any(rules: Json) -> Json {
    json!({"version": 1, "where": {"op": "any", "not": false, "rules": rules}, "sort": [{"by": "name", "dir": "asc"}]})
}
fn tag_rule(id: &str, subtags: bool, not: bool) -> Json {
    json!({"kind": "tag", "tagId": id, "subtags": subtags, "not": not})
}
fn field_rule(id: &str, test: Json, not: bool) -> Json {
    json!({"kind": "field", "fieldId": id, "test": test, "not": not})
}

// ---------------------------------------------------------------- reading queries

#[test]
fn reads_what_typescript_writes_and_writes_it_back_the_same() {
    let text = include_str!("../../tests/fixtures/queries.json");
    let list: Vec<Json> = serde_json::from_str(text).unwrap();
    assert!(list.len() >= 5);
    for raw in list {
        let query = from_value(raw.clone()).unwrap_or_else(|e| panic!("{raw}: {e}"));
        assert!(same_json(&serde_json::to_value(&query).unwrap(), &raw), "{raw}\nbecame\n{}", serde_json::to_value(&query).unwrap());
    }
}

/// JSON equality where 5 and 5.0 are the same number.
fn same_json(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Number(x), Json::Number(y)) => x.as_f64() == y.as_f64(),
        (Json::Array(x), Json::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, r)| same_json(p, r)),
        (Json::Object(x), Json::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same_json(v, w))),
        _ => a == b,
    }
}

#[test]
fn refuses_what_is_not_a_query_with_a_sentence() {
    let why = |json: &str| parse(json).unwrap_err().to_string();
    assert!(why("not json").contains("valid query"));
    assert!(why("{}").contains("valid query"));
    assert!(why(r#"{"version": 2, "where": {"op": "all", "rules": []}}"#).contains("newer"));
    assert!(why(r#"{"version": 1, "where": {"op": "xor", "rules": []}}"#).contains("valid query"));
    assert!(why(r#"{"version": 1, "where": {"op": "all", "rules": [{"kind": "weather"}]}}"#).contains("valid query"));
    assert!(why(r#"{"version": 1, "where": {"op": "all", "rules": [{"kind": "changed", "days": 0}]}}"#).contains("days"));
}

#[test]
fn refuses_queries_that_are_too_big() {
    let mut deep = json!({"op": "all", "rules": []});
    for _ in 0..MAX_DEPTH {
        deep = json!({"op": "all", "rules": [deep]});
    }
    assert!(from_value(json!({"version": 1, "where": deep})).unwrap_err().to_string().contains("deeply"));

    let many: Vec<Json> = (0..=MAX_NODES).map(|_| tag_rule("a", true, false)).collect();
    assert!(from_value(q(Json::Array(many))).unwrap_err().to_string().contains("too many"));

    let long = "x".repeat(MAX_TEXT_CHARS + 1);
    assert!(from_value(q(json!([{"kind": "name", "text": long}]))).is_err());
    let ids: Vec<String> = (0..=MAX_IDS).map(|i| i.to_string()).collect();
    assert!(from_value(q(json!([{"kind": "itemType", "types": ids}]))).is_err());
    assert!(from_value(json!({"version": 1, "where": {"op": "all", "rules": []}, "sort": [{"by": "name"}, {"by": "type"}, {"by": "created"}, {"by": "updated"}]})).is_err());
}

#[test]
fn missing_optional_parts_take_their_defaults() {
    let query = from_value(json!({"version": 1, "where": {"op": "any", "rules": [{"kind": "tag", "tagId": "a", "subtags": true}]}})).unwrap();
    assert!(query.sort.is_empty());
    assert!(!query.where_.not);
    let Node::Rule(rule) = &query.where_.rules[0] else { panic!() };
    assert!(!rule.not);
}

// ---------------------------------------------------------------- running them

#[test]
fn an_empty_query_finds_every_live_item_by_name() {
    let mut fx = Fx::new();
    fx.doc("beta");
    fx.doc("Alpha");
    let gone = fx.doc("Gone");
    items::soft_delete(&fx.conn, &gone, 500).unwrap();
    assert_eq!(fx.run(q(json!([]))), ["Alpha", "beta"]);
}

#[test]
fn documents_inside_another_pages_tabs_are_not_in_the_answer() {
    let mut fx = Fx::new();
    let page = fx.doc("Page");
    let tab = tabs::add_document_tab(&fx.conn, &page, "Hidden tab", 5).unwrap();
    assert!(tab.item.is_some());
    assert_eq!(fx.run(q(json!([]))), ["Page"]);
}

#[test]
fn filters_by_type_and_tool() {
    let mut fx = Fx::new();
    fx.doc("Doc");
    fx.item("cards", "card", "Card");
    fx.item("cards", "set", "Set");
    assert_eq!(fx.run(q(json!([{"kind": "itemType", "types": ["card", "set"], "not": false}]))), ["Card", "Set"]);
    assert_eq!(fx.run(q(json!([{"kind": "itemType", "types": ["card", "set"], "not": true}]))), ["Doc"]);
    assert_eq!(fx.run(q(json!([{"kind": "library", "libraries": ["cards"], "not": false}]))), ["Card", "Set"]);
    assert_eq!(fx.run_with(q(json!([])), Some("set")), ["Set"]);
}

#[test]
fn filters_by_folder_with_and_without_subfolders() {
    let mut fx = Fx::new();
    let top = fx.folder(None, "Top");
    let sub = fx.folder(Some(&top), "Sub");
    let other = fx.folder(None, "Other");
    for (name, folder) in [("In top", &top), ("In sub", &sub), ("In other", &other)] {
        let id = fx.doc(name);
        fx.put_in(&id, folder);
    }
    fx.doc("Loose");
    let rule = |sub: bool, not: bool| q(json!([{"kind": "folder", "folderId": top, "subfolders": sub, "not": not}]));
    assert_eq!(fx.run(rule(true, false)), ["In sub", "In top"]);
    assert_eq!(fx.run(rule(false, false)), ["In top"]);
    assert_eq!(fx.run(rule(true, true)), ["In other", "Loose"]);
    let now = 900;
    folders::soft_delete(&fx.conn, &sub, now).unwrap();
    assert_eq!(fx.run(rule(true, false)), ["In top"]);
    assert_eq!(fx.run(q(json!([{"kind": "folder", "folderId": "no-such-folder", "subfolders": true, "not": true}]))).len(), 3);
}

#[test]
fn filters_by_tag_with_and_without_subtags() {
    let mut fx = Fx::new();
    let npc = fx.tag(None, "NPC");
    let elf = fx.tag(Some(&npc), "Elf");
    let place = fx.tag(None, "Place");
    for (name, tag) in [("Bob", &npc), ("Lia", &elf), ("Rome", &place)] {
        let id = fx.doc(name);
        fx.tag_item(&id, tag);
    }
    fx.doc("Untagged");
    assert_eq!(fx.run(q(json!([tag_rule(&npc, true, false)]))), ["Bob", "Lia"]);
    assert_eq!(fx.run(q(json!([tag_rule(&npc, false, false)]))), ["Bob"]);
    assert_eq!(fx.run(q(json!([tag_rule(&npc, true, true)]))), ["Rome", "Untagged"]);
    assert_eq!(fx.run(q(json!([tag_rule(&elf, true, false)]))), ["Lia"]);
    // a deleted tag matches nothing; not of it matches everything
    tags::soft_delete(&fx.conn, &npc, 900).unwrap();
    assert!(fx.run(q(json!([tag_rule(&npc, true, false)]))).is_empty());
    assert_eq!(fx.run(q(json!([tag_rule(&npc, true, true)]))).len(), 4);
}

#[test]
fn finds_text_in_names_bodies_and_fields_ignoring_case() {
    let mut fx = Fx::new();
    let a = fx.doc("Élodie the Wolf");
    let b = fx.doc("Plain");
    let c = fx.doc("Other");
    documents::set_body(&fx.conn, &b, "Once, a WOLF came to town.", 5).unwrap();
    let notes = fx.field("Notes", "text", "{}");
    fx.set_text(&c, &notes, "Hunted by wolves");
    let name = |t: &str| q(json!([{"kind": "name", "text": t, "not": false}]));
    let text = |t: &str| q(json!([{"kind": "text", "text": t, "not": false}]));
    assert_eq!(fx.run(name("WOLF")), ["Élodie the Wolf"]);
    assert_eq!(fx.run(name("élodie")), ["Élodie the Wolf"]);
    assert_eq!(fx.run(name("ÉLODIE")), ["Élodie the Wolf"]);
    assert_eq!(fx.run(text("wolf")), ["Plain", "Élodie the Wolf"]); // by name: É sorts after P
    assert_eq!(fx.run(text("wolves")), ["Other"]);
    let _ = a;
}

#[test]
fn text_the_person_typed_is_never_part_of_the_sql() {
    let mut fx = Fx::new();
    fx.doc("It's fine");
    fx.doc("Other");
    let attack = "'); DROP TABLE items; --";
    assert!(fx.run(q(json!([{"kind": "name", "text": attack, "not": false}]))).is_empty());
    assert_eq!(fx.run(q(json!([{"kind": "name", "text": "it's", "not": false}]))), ["It's fine"]);
    assert_eq!(fx.run(q(json!([]))).len(), 2);
    let odd = "%_\\";
    assert!(fx.run(q(json!([{"kind": "name", "text": odd, "not": false}]))).is_empty());
}

#[test]
fn every_kind_of_field_test_works() {
    let mut fx = Fx::new();
    let ash = fx.doc("Ash");
    let birch = fx.doc("Birch");
    let cedar = fx.doc("Cedar");
    let dune = fx.doc("Dune");
    let role = fx.field("Role", "text", "{}");
    let level = fx.field("Level", "number", "{}");
    let hp = fx.field("HP", "bar", "{}");
    let mood = fx.field("Mood", "dropdown", r#"{"options":[{"id":"calm","label":"Calm","color":null},{"id":"angry","label":"Angry","color":null}]}"#);
    let traits = fx.field("Traits", "list", "{}");
    let home = fx.field("Home", "link", r#"{"many":false}"#);
    fx.set_text(&ash, &role, "Innkeeper");
    fx.set_text(&birch, &role, "  guard  ");
    fx.set_text(&cedar, &role, "");
    fx.set_number(&ash, &level, 3.0);
    fx.set_number(&birch, &level, 7.5);
    fx.set(&ash, &hp, json!({"current": 5, "max": 9}), (Some(5.0), None, "5/9"));
    fx.set(&ash, &mood, json!("calm"), (Some(0.0), Some("calm"), "Calm"));
    fx.set(&birch, &mood, json!("angry"), (Some(1.0), Some("angry"), "Angry"));
    fx.set(&ash, &traits, json!([{"title": "Brave", "text": "Never runs"}]), (Some(1.0), Some("brave"), "Brave\nNever runs"));
    fx.set(&cedar, &traits, json!([]), (None, None, ""));
    fx.set(&ash, &home, json!([dune]), (Some(1.0), None, ""));

    let f = |id: &str, test: Json, not: bool| fx.run(q(json!([field_rule(id, test, not)])));
    assert_eq!(f(&role, json!({"check": "contains", "text": "KEEP"}), false), ["Ash"]);
    assert_eq!(f(&role, json!({"check": "equals", "text": "GUARD"}), false), ["Birch"]);
    assert_eq!(f(&role, json!({"check": "equals", "text": "guar"}), false), Vec::<String>::new());
    assert_eq!(f(&role, json!({"check": "empty"}), false), ["Cedar", "Dune"]);
    assert_eq!(f(&role, json!({"check": "empty"}), true), ["Ash", "Birch"]);
    assert_eq!(f(&level, json!({"check": "number", "cmp": ">=", "value": 3}), false), ["Ash", "Birch"]);
    assert_eq!(f(&level, json!({"check": "number", "cmp": "<", "value": 5}), false), ["Ash"]);
    assert_eq!(f(&level, json!({"check": "number", "cmp": "=", "value": 7.5}), false), ["Birch"]);
    assert_eq!(f(&level, json!({"check": "between", "min": 3, "max": 7}), false), ["Ash"]);
    assert_eq!(f(&level, json!({"check": "number", "cmp": ">", "value": 5}), true), ["Ash", "Cedar", "Dune"]);
    assert_eq!(f(&hp, json!({"check": "number", "cmp": ">=", "value": 5}), false), ["Ash"]);
    assert_eq!(f(&mood, json!({"check": "choice", "optionIds": ["angry", "other"]}), false), ["Birch"]);
    assert_eq!(f(&mood, json!({"check": "choice", "optionIds": ["calm"]}), true), ["Birch", "Cedar", "Dune"]);
    assert_eq!(f(&traits, json!({"check": "contains", "text": "never"}), false), ["Ash"]);
    assert_eq!(f(&traits, json!({"check": "empty"}), false), ["Birch", "Cedar", "Dune"]);
    assert_eq!(f(&home, json!({"check": "links", "itemId": dune}), false), ["Ash"]);
    assert_eq!(f(&home, json!({"check": "links", "itemId": ash}), false), Vec::<String>::new());
    assert_eq!(f(&home, json!({"check": "empty"}), true), ["Ash"]);
    // a test that doesn't suit the field's kind, or a field that doesn't exist, matches nothing
    assert!(f(&level, json!({"check": "contains", "text": "3"}), false).is_empty());
    assert!(f("no-such-field", json!({"check": "empty"}), false).is_empty());
    assert_eq!(f("no-such-field", json!({"check": "empty"}), true).len(), 4);
    // a deleted field matches nothing too
    fields::delete_definition(&fx.conn, &level, 900).unwrap();
    assert!(fx.run(q(json!([field_rule(&level, json!({"check": "number", "cmp": ">=", "value": 0}), false)]))).is_empty());
}

#[test]
fn filters_by_links_in_both_directions() {
    let mut fx = Fx::new();
    let a = fx.doc("A");
    let b = fx.doc("B");
    let c = fx.doc("C");
    fx.link(&a, &b, "manual");
    fx.link(&c, &b, "body");
    let rule = |kind: &str, id: &str, not: bool| q(json!([{"kind": kind, "itemId": id, "not": not}]));
    assert_eq!(fx.run(rule("linksTo", &b, false)), ["A", "C"]);
    assert_eq!(fx.run(rule("linksTo", &b, true)), ["B"]);
    assert_eq!(fx.run(rule("linkedFrom", &a, false)), ["B"]);
    // trashing the other end hides the link
    items::soft_delete(&fx.conn, &b, 900).unwrap();
    assert!(fx.run(rule("linksTo", &b, false)).is_empty());
}

#[test]
fn filters_by_when_something_changed() {
    let mut fx = Fx::new();
    let old = fx.doc("Old");
    let fresh = fx.doc("Fresh");
    fx.conn.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", rusqlite::params![old, NOW - 10 * DAY_MS]).unwrap();
    fx.conn.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", rusqlite::params![fresh, NOW - 2 * DAY_MS]).unwrap();
    assert_eq!(fx.run(q(json!([{"kind": "changed", "days": 3, "not": false}]))), ["Fresh"]);
    assert_eq!(fx.run(q(json!([{"kind": "changed", "days": 30, "not": false}]))), ["Fresh", "Old"]);
    assert_eq!(fx.run(q(json!([{"kind": "changed", "days": 3, "not": true}]))), ["Old"]);
}

#[test]
fn groups_combine_rules_and_incomplete_parts_are_ignored() {
    let mut fx = Fx::new();
    let t1 = fx.tag(None, "One");
    let t2 = fx.tag(None, "Two");
    for (name, tags) in [("Both", vec![&t1, &t2]), ("OnlyOne", vec![&t1]), ("OnlyTwo", vec![&t2]), ("Neither", vec![])] {
        let id = fx.doc(name);
        for t in tags {
            fx.tag_item(&id, t);
        }
    }
    let rules = json!([tag_rule(&t1, true, false), tag_rule(&t2, true, false)]);
    assert_eq!(fx.run(q(rules.clone())), ["Both"]);
    assert_eq!(fx.run(q_any(rules.clone())), ["Both", "OnlyOne", "OnlyTwo"]);
    let mut negated = q(rules.clone());
    negated["where"]["not"] = json!(true);
    assert_eq!(fx.run(negated), ["Neither", "OnlyOne", "OnlyTwo"]);
    // nested: tagged One and (Two or named Neither)
    let nested = q(json!([tag_rule(&t1, true, false), {"op": "any", "not": false, "rules": [tag_rule(&t2, true, false), {"kind": "name", "text": "neither", "not": false}]}]));
    assert_eq!(fx.run(nested), ["Both"]);
    // incomplete rules and empty groups are skipped, in "all" and "any" alike
    let sloppy = json!([tag_rule(&t1, true, false), tag_rule("", true, false), {"kind": "name", "text": "  ", "not": false}, {"op": "any", "not": false, "rules": []}]);
    assert_eq!(fx.run(q(sloppy.clone())), ["Both", "OnlyOne"]);
    assert_eq!(fx.run(q_any(sloppy)), ["Both", "OnlyOne"]);
    assert_eq!(fx.run(q(json!([tag_rule("", true, false)]))).len(), 4);
}

#[test]
fn sorts_by_several_keys_with_empty_values_last() {
    let mut fx = Fx::new();
    let rank = fx.field("Rank", "number", "{}");
    let role = fx.field("Role", "text", "{}");
    for (name, r, role_text) in [("A", Some(2.0), Some("b")), ("B", Some(1.0), Some("a")), ("C", None, None), ("D", Some(2.0), Some("a")), ("E", Some(1.0), None)] {
        let id = fx.doc(name);
        if let Some(r) = r {
            fx.set_number(&id, &rank, r);
        }
        if let Some(t) = role_text {
            fx.set_text(&id, &role, t);
        }
    }
    let by = |sort: Json| {
        let mut query = q(json!([]));
        query["sort"] = sort;
        fx.run(query)
    };
    assert_eq!(by(json!([{"by": "field", "fieldId": rank, "dir": "asc"}])), ["B", "E", "A", "D", "C"]);
    assert_eq!(by(json!([{"by": "field", "fieldId": rank, "dir": "desc"}])), ["A", "D", "B", "E", "C"]);
    assert_eq!(by(json!([{"by": "field", "fieldId": rank, "dir": "asc"}, {"by": "field", "fieldId": role, "dir": "desc"}])), ["B", "E", "A", "D", "C"]);
    assert_eq!(by(json!([{"by": "field", "fieldId": rank, "dir": "desc"}, {"by": "field", "fieldId": role, "dir": "asc"}])), ["D", "A", "B", "E", "C"]);
    assert_eq!(by(json!([{"by": "name", "dir": "desc"}])), ["E", "D", "C", "B", "A"]);
    assert_eq!(by(json!([{"by": "created", "dir": "desc"}])), ["E", "D", "C", "B", "A"]);
    // sorting by a field that doesn't exist is skipped, falling back to the name
    assert_eq!(by(json!([{"by": "field", "fieldId": "nope", "dir": "desc"}])), ["A", "B", "C", "D", "E"]);
}

#[test]
fn an_answer_is_cut_off_at_the_limit_and_says_so() {
    let fx = Fx::new();
    {
        let tx = fx.conn.unchecked_transaction().unwrap();
        for i in 0..(MAX_RESULTS + 3) {
            tx.execute(
                "INSERT INTO items (id, campaign_id, library, item_type, name, created_at, updated_at) VALUES (?1, ?2, 'worldbuilding', 'document', ?3, 1, 1)",
                rusqlite::params![format!("id-{i:05}"), fx.camp, format!("Item {i:05}")],
            )
            .unwrap();
        }
        tx.commit().unwrap();
    }
    let result = run(&fx.conn, &fx.camp, &from_value(q(json!([]))).unwrap(), NOW, None).unwrap();
    assert_eq!(result.items.len(), MAX_RESULTS);
    assert!(result.truncated);
    assert_eq!(result.items[0].name, "Item 00000");
}

#[test]
fn only_looks_at_its_own_campaign() {
    let mut fx = Fx::new();
    fx.doc("Mine");
    let other = campaigns::create(&fx.conn, "Other", 1).unwrap().id;
    items::create(&fx.conn, &other, "worldbuilding", "document", "Theirs", None, 1).unwrap();
    assert_eq!(fx.run(q(json!([]))), ["Mine"]);
}

// ---------------------------------------------------------------- the slow, obviously-correct evaluator

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn chance(&mut self, one_in: usize) -> bool {
        self.below(one_in) == 0
    }
    fn pick<'a, T>(&mut self, list: &'a [T]) -> &'a T {
        &list[self.below(list.len())]
    }
}

struct ItemRow {
    id: String,
    library: String,
    item_type: String,
    name: String,
    folder_id: Option<String>,
    created_at: i64,
    updated_at: i64,
}

struct ValueRow {
    json: Json,
    search_text: String,
    sort_num: Option<f64>,
    sort_text: Option<String>,
}

/// Everything in the database, read into plain Rust, for deciding by hand what a query should find.
struct World {
    now: i64,
    items: Vec<ItemRow>,
    live_items: HashSet<String>,
    tab_children: HashSet<String>,
    folder_parent: HashMap<String, Option<String>>,
    tag_parent: HashMap<String, Option<String>>,
    item_tags: Vec<(String, String)>,
    field_kind: HashMap<String, String>,
    values: HashMap<(String, String), ValueRow>,
    links: Vec<(String, String, String)>,
    bodies: HashMap<String, String>,
}

impl World {
    fn load(conn: &Connection, now: i64) -> World {
        let strings = |sql: &str| -> Vec<Vec<Option<String>>> {
            let mut stmt = conn.prepare(sql).unwrap();
            let n = stmt.column_count();
            stmt.query_map([], |r| (0..n).map(|i| r.get::<_, Option<String>>(i)).collect::<Result<Vec<_>, _>>())
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        let live_items: HashSet<String> = strings("SELECT id FROM items WHERE deleted_at IS NULL").into_iter().map(|r| r[0].clone().unwrap()).collect();
        let items = {
            let mut stmt = conn.prepare("SELECT id, library, item_type, name, folder_id, created_at, updated_at FROM items WHERE deleted_at IS NULL").unwrap();
            let rows = stmt
                .query_map([], |r| {
                    Ok(ItemRow {
                        id: r.get(0)?,
                        library: r.get(1)?,
                        item_type: r.get(2)?,
                        name: r.get(3)?,
                        folder_id: r.get(4)?,
                        created_at: r.get(5)?,
                        updated_at: r.get(6)?,
                    })
                })
                .unwrap();
            rows.map(|r| r.unwrap()).collect::<Vec<_>>()
        };
        let values = {
            let mut stmt = conn.prepare("SELECT item_id, field_id, value_json, search_text, sort_num, sort_text FROM field_values WHERE deleted_at IS NULL").unwrap();
            let rows = stmt
                .query_map([], |r| {
                    let json: String = r.get(2)?;
                    Ok((
                        (r.get::<_, String>(0)?, r.get::<_, String>(1)?),
                        ValueRow { json: serde_json::from_str(&json).unwrap(), search_text: r.get(3)?, sort_num: r.get(4)?, sort_text: r.get(5)? },
                    ))
                })
                .unwrap();
            rows.map(|r| r.unwrap()).collect()
        };
        World {
            now,
            items,
            live_items,
            tab_children: strings("SELECT child_id FROM item_tabs WHERE child_id IS NOT NULL").into_iter().map(|r| r[0].clone().unwrap()).collect(),
            folder_parent: strings("SELECT id, parent_id FROM folders WHERE deleted_at IS NULL").into_iter().map(|r| (r[0].clone().unwrap(), r[1].clone())).collect(),
            tag_parent: strings("SELECT id, parent_id FROM tags WHERE deleted_at IS NULL").into_iter().map(|r| (r[0].clone().unwrap(), r[1].clone())).collect(),
            item_tags: strings("SELECT item_id, tag_id FROM item_tags WHERE deleted_at IS NULL").into_iter().map(|r| (r[0].clone().unwrap(), r[1].clone().unwrap())).collect(),
            field_kind: strings("SELECT id, kind FROM field_definitions WHERE deleted_at IS NULL").into_iter().map(|r| (r[0].clone().unwrap(), r[1].clone().unwrap())).collect(),
            values,
            links: strings("SELECT source_item_id, target_item_id, source_ref FROM links WHERE deleted_at IS NULL").into_iter().map(|r| (r[0].clone().unwrap(), r[1].clone().unwrap(), r[2].clone().unwrap())).collect(),
            bodies: strings("SELECT item_id, body FROM document_content").into_iter().map(|r| (r[0].clone().unwrap(), r[1].clone().unwrap())).collect(),
        }
    }

    /// `id` is `root` or lies beneath it (walking up through live parents only).
    fn under(parents: &HashMap<String, Option<String>>, id: &str, root: &str, include_below: bool) -> bool {
        if !parents.contains_key(root) {
            return false; // a deleted or unknown root matches nothing
        }
        if id == root {
            return true;
        }
        if !include_below {
            return false;
        }
        let mut current = id;
        for _ in 0..20 {
            let Some(Some(parent)) = parents.get(current) else { return false };
            if parent == root {
                return true;
            }
            current = parent;
        }
        false
    }

    fn matches_node(&self, item: &ItemRow, node: &Node) -> Option<bool> {
        match node {
            Node::Group(g) => self.matches_group(item, g),
            Node::Rule(r) => {
                if !is_complete(r) {
                    return None;
                }
                let truth = self.matches_rule(item, &r.body);
                Some(truth != r.not)
            }
        }
    }

    fn matches_group(&self, item: &ItemRow, group: &Group) -> Option<bool> {
        let results: Vec<bool> = group.rules.iter().filter_map(|n| self.matches_node(item, n)).collect();
        if results.is_empty() {
            return None;
        }
        let truth = match group.op {
            Op::All => results.iter().all(|b| *b),
            Op::Any => results.iter().any(|b| *b),
        };
        Some(truth != group.not)
    }

    fn matches_rule(&self, item: &ItemRow, body: &RuleBody) -> bool {
        match body {
            RuleBody::ItemType { types } => types.contains(&item.item_type),
            RuleBody::Library { libraries } => libraries.contains(&item.library),
            RuleBody::Folder { folder_id, subfolders } => item.folder_id.as_ref().is_some_and(|f| Self::under(&self.folder_parent, f, folder_id, *subfolders)),
            RuleBody::Tag { tag_id, subtags } => self.item_tags.iter().any(|(i, t)| i == &item.id && Self::under(&self.tag_parent, t, tag_id, *subtags)),
            RuleBody::Name { text } => fold(&item.name).contains(&fold_trim(text)),
            RuleBody::Text { text } => {
                let needle = fold_trim(text);
                fold(&item.name).contains(&needle)
                    || self.bodies.get(&item.id).is_some_and(|b| fold(b).contains(&needle))
                    || self.values.iter().any(|((i, f), v)| i == &item.id && self.field_kind.contains_key(f) && fold(&v.search_text).contains(&needle))
            }
            RuleBody::LinksTo { item_id } => self.links.iter().any(|(s, t, _)| s == &item.id && t == item_id && self.live_items.contains(t)),
            RuleBody::LinkedFrom { item_id } => self.links.iter().any(|(s, t, _)| s == item_id && t == &item.id && self.live_items.contains(s)),
            RuleBody::Changed { days } => item.updated_at >= self.now - days * DAY_MS,
            RuleBody::Field { field_id, test } => {
                let Some(kind) = self.field_kind.get(field_id) else { return false };
                if !test_suits_kind(test, kind) {
                    return false;
                }
                let value = self.values.get(&(item.id.clone(), field_id.clone()));
                match test {
                    FieldTest::Contains { text } => value.is_some_and(|v| fold(&v.search_text).contains(&fold_trim(text))),
                    FieldTest::Equals { text } => value.is_some_and(|v| fold_trim(&v.search_text) == fold_trim(text)),
                    FieldTest::Number { cmp, value: x } => value.and_then(|v| v.sort_num).is_some_and(|n| match cmp {
                        Cmp::Eq => n == *x,
                        Cmp::Lt => n < *x,
                        Cmp::Le => n <= *x,
                        Cmp::Gt => n > *x,
                        Cmp::Ge => n >= *x,
                    }),
                    FieldTest::Between { min, max } => value.and_then(|v| v.sort_num).is_some_and(|n| *min <= n && n <= *max),
                    FieldTest::Choice { option_ids } => value.is_some_and(|v| v.json.as_str().is_some_and(|s| option_ids.iter().any(|o| o == s))),
                    FieldTest::Links { item_id } => {
                        let wanted = fields::link_ref(field_id);
                        self.links.iter().any(|(s, t, r)| s == &item.id && t == item_id && r == &wanted && self.live_items.contains(t))
                    }
                    FieldTest::Empty => !value.is_some_and(|v| match kind.as_str() {
                        "text" | "formula" => v.json.as_str().is_some_and(|s| !s.is_empty()),
                        "number" | "bar" | "dropdown" => !v.json.is_null(),
                        _ => v.json.as_array().is_some_and(|a| !a.is_empty()),
                    }),
                }
            }
        }
    }

    /// The ids a query should find, in the order it should find them.
    fn expected(&self, query: &Query, only_type: Option<&str>) -> Vec<String> {
        let mut found: Vec<&ItemRow> = self
            .items
            .iter()
            .filter(|i| !self.tab_children.contains(&i.id))
            .filter(|i| only_type.is_none_or(|t| i.item_type == t))
            .filter(|i| self.matches_group(i, &query.where_).unwrap_or(true))
            .collect();
        found.sort_by(|a, b| {
            for key in &query.sort {
                let (ord, dir) = match key {
                    SortKey::Name { dir } => (a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()), *dir),
                    SortKey::Created { dir } => (a.created_at.cmp(&b.created_at), *dir),
                    SortKey::Updated { dir } => (a.updated_at.cmp(&b.updated_at), *dir),
                    SortKey::Type { dir } => (a.item_type.cmp(&b.item_type), *dir),
                    SortKey::Field { field_id, dir } => {
                        let Some(kind) = self.field_kind.get(field_id) else { continue };
                        let mut ord = std::cmp::Ordering::Equal;
                        let columns: &[&str] = match kind.as_str() {
                            "text" | "formula" => &["text"],
                            "list" => &["text", "num"],
                            _ => &["num"],
                        };
                        for column in columns {
                            let get = |item: &ItemRow| {
                                self.values.get(&(item.id.clone(), field_id.clone())).map(|v| match *column {
                                    "text" => (v.sort_text.clone(), None),
                                    _ => (None, v.sort_num),
                                })
                            };
                            let (x, y) = (get(a), get(b));
                            let empty = |v: &Option<(Option<String>, Option<f64>)>| v.as_ref().is_none_or(|(t, n)| t.is_none() && n.is_none());
                            // missing values go last whichever way the order runs
                            let step = match (empty(&x), empty(&y)) {
                                (true, true) => std::cmp::Ordering::Equal,
                                (true, false) => return std::cmp::Ordering::Greater,
                                (false, true) => return std::cmp::Ordering::Less,
                                (false, false) => {
                                    let (x, y) = (x.unwrap(), y.unwrap());
                                    let o = if *column == "text" { x.0.cmp(&y.0) } else { x.1.partial_cmp(&y.1).unwrap() };
                                    if *dir == Dir::Desc { o.reverse() } else { o }
                                }
                            };
                            if step != std::cmp::Ordering::Equal {
                                ord = step;
                                break;
                            }
                        }
                        (ord, Dir::Asc)
                    }
                };
                let ord = if dir == Dir::Desc { ord.reverse() } else { ord };
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
            }
            a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()).then(a.id.cmp(&b.id))
        });
        found.into_iter().map(|i| i.id.clone()).collect()
    }
}

// ---------------------------------------------------------------- random campaigns and random questions

struct Ids {
    folders: Vec<String>,
    tags: Vec<String>,
    fields: Vec<(String, &'static str, Vec<String>)>, // id, kind, dropdown option ids
    items: Vec<String>,
}

const NAMES: &[&str] = &["Ash", "ash tree", "Birch", "Élodie", "élan", "Cedar", "Dune", "wolf", "Wolfram", "Oak", "oak-man", "It's", "100%"];
const WORDS: &[&str] = &["ash", "wolf", "ÉLO", "oak", "a", "'", "%", "x", "guard", "calm", "1"];

fn build_world(rng: &mut Rng) -> (Fx, Ids) {
    let mut fx = Fx::new();
    let mut ids = Ids { folders: vec![], tags: vec![], fields: vec![], items: vec![] };

    for i in 0..5 {
        let parent = if i > 0 && rng.chance(2) { Some(ids.folders[rng.below(ids.folders.len())].clone()) } else { None };
        ids.folders.push(fx.folder(parent.as_deref(), &format!("F{i}")));
    }
    for i in 0..6 {
        let parent = if i > 0 && rng.chance(2) { Some(ids.tags[rng.below(ids.tags.len())].clone()) } else { None };
        ids.tags.push(fx.tag(parent.as_deref(), &format!("T{i}")));
    }
    let options = r#"{"options":[{"id":"calm","label":"Calm","color":null},{"id":"angry","label":"Angry","color":null},{"id":"sad","label":"Sad","color":null}]}"#;
    for (name, kind) in [("Role", "text"), ("Level", "number"), ("HP", "bar"), ("Mood", "dropdown"), ("Traits", "list"), ("Home", "link"), ("Roll", "formula"), ("Rank", "number")] {
        let config = if kind == "dropdown" { options } else if kind == "link" { r#"{"many":true}"# } else { "{}" };
        let id = fx.field(name, kind, config);
        let opts = if kind == "dropdown" { vec!["calm".into(), "angry".into(), "sad".into()] } else { vec![] };
        ids.fields.push((id, kind, opts));
    }

    let libs = [("worldbuilding", "document"), ("worldbuilding", "template"), ("cards", "card"), ("cards", "set"), ("dice", "formula")];
    for i in 0..36 {
        let (lib, kind) = *rng.pick(&libs);
        let name = format!("{}{}", rng.pick(NAMES), if rng.chance(3) { i.to_string() } else { String::new() });
        ids.items.push(fx.item(lib, kind, &name));
    }
    for id in ids.items.clone() {
        if rng.chance(2) {
            let f = ids.folders[rng.below(ids.folders.len())].clone();
            // only worldbuilding items can go in worldbuilding folders; ignore the refusal for the rest
            let now = fx.tick();
            let _ = items::move_to(&fx.conn, &id, Some(&f), now);
        }
        for t in &ids.tags.clone() {
            if rng.chance(4) {
                fx.tag_item(&id, t);
            }
        }
        if rng.chance(3) {
            let now = fx.tick();
            let _ = documents::set_body(&fx.conn, &id, &format!("Body with {} inside", rng.pick(WORDS)), now);
        }
        for (field, kind, opts) in ids.fields.clone() {
            if !rng.chance(2) {
                continue;
            }
            match kind {
                "text" | "formula" => {
                    let text = rng.pick(&["", "Guard", "  guard ", "Innkeeper of Ash", "1d6", "ÉLODIE"]).to_string();
                    fx.set_text(&id, &field, &text);
                }
                "number" => {
                    let n = rng.below(12) as f64 / 2.0;
                    fx.set_number(&id, &field, n);
                }
                "bar" => {
                    let c = rng.below(10) as f64;
                    fx.set(&id, &field, json!({"current": c, "max": 10}), (Some(c), None, &format!("{c}/10")));
                }
                "dropdown" => {
                    if rng.chance(5) {
                        fx.set(&id, &field, Json::Null, (None, None, ""));
                    } else {
                        let at = rng.below(opts.len());
                        let label = format!("{}{}", opts[at][..1].to_uppercase(), &opts[at][1..]);
                        fx.set(&id, &field, json!(opts[at]), (Some(at as f64), Some(label.to_lowercase().as_str()), label.as_str()));
                    }
                }
                "list" => {
                    let n = rng.below(3);
                    let entries: Vec<Json> = (0..n).map(|k| json!({"title": format!("Trait {k}"), "text": rng.pick(WORDS)})).collect();
                    let search = entries.iter().map(|e| format!("{}\n{}", e["title"].as_str().unwrap(), e["text"].as_str().unwrap())).collect::<Vec<_>>().join("\n");
                    if n == 0 {
                        fx.set(&id, &field, json!([]), (None, None, ""));
                    } else {
                        fx.set(&id, &field, json!(entries), (Some(n as f64), Some("trait 0"), &search));
                    }
                }
                _ => {
                    let target = ids.items[rng.below(ids.items.len())].clone();
                    if target != id {
                        fx.set(&id, &field, json!([target]), (Some(1.0), None, ""));
                    }
                }
            }
        }
        if rng.chance(4) {
            let target = ids.items[rng.below(ids.items.len())].clone();
            if target != id {
                let r = *rng.pick(&["manual", "body"]);
                fx.link(&id, &target, r);
            }
        }
        if rng.chance(8) {
            let now = fx.tick();
            let _ = tabs::add_document_tab(&fx.conn, &id, "Tab", now);
        }
        // spread update times so "changed" and "updated" sorts have something to chew on
        let when = NOW - (rng.below(40) as i64) * DAY_MS / 2;
        fx.conn.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", rusqlite::params![id, when]).unwrap();
    }
    // some trashing, so deleted things are in the mix
    for _ in 0..3 {
        let now = fx.tick();
        let _ = items::soft_delete(&fx.conn, rng.pick(&ids.items), now);
    }
    let now = fx.tick();
    let _ = tags::soft_delete(&fx.conn, rng.pick(&ids.tags), now);
    let now = fx.tick();
    let _ = folders::soft_delete(&fx.conn, rng.pick(&ids.folders), now);
    let now = fx.tick();
    let _ = fields::delete_definition(&fx.conn, &ids.fields[rng.below(ids.fields.len())].0, now);
    (fx, ids)
}

fn random_id(rng: &mut Rng, pool: &[String]) -> String {
    match rng.below(10) {
        0 => String::new(),
        1 => "no-such-id".into(),
        _ => rng.pick(pool).clone(),
    }
}

fn random_rule(rng: &mut Rng, ids: &Ids) -> Json {
    let not = rng.chance(3);
    match rng.below(10) {
        0 => json!({"kind": "itemType", "types": (0..rng.below(3)).map(|_| *rng.pick(&["document", "template", "card", "set", "formula", "nothing"])).collect::<Vec<_>>(), "not": not}),
        1 => json!({"kind": "library", "libraries": (0..rng.below(3)).map(|_| *rng.pick(&["worldbuilding", "cards", "dice"])).collect::<Vec<_>>(), "not": not}),
        2 => json!({"kind": "folder", "folderId": random_id(rng, &ids.folders), "subfolders": rng.chance(2), "not": not}),
        3 | 4 => json!({"kind": "tag", "tagId": random_id(rng, &ids.tags), "subtags": rng.chance(2), "not": not}),
        5 => json!({"kind": if rng.chance(2) { "name" } else { "text" }, "text": *rng.pick(WORDS), "not": not}),
        6 => json!({"kind": if rng.chance(2) { "linksTo" } else { "linkedFrom" }, "itemId": random_id(rng, &ids.items), "not": not}),
        7 => json!({"kind": "changed", "days": 1 + rng.below(25), "not": not}),
        _ => {
            let at = rng.below(ids.fields.len());
            let (id, kind, opts) = &ids.fields[at];
            let id = if rng.chance(12) { "no-such-field".to_string() } else { id.clone() };
            let test = match rng.below(7) {
                0 => json!({"check": "contains", "text": *rng.pick(WORDS)}),
                1 => json!({"check": "equals", "text": *rng.pick(&["guard", "GUARD ", "1d6", "élodie", "x"])}),
                2 => json!({"check": "number", "cmp": *rng.pick(&["=", "<", "<=", ">", ">="]), "value": rng.below(12) as f64 / 2.0}),
                3 => json!({"check": "between", "min": rng.below(6), "max": rng.below(12)}),
                4 => json!({"check": "choice", "optionIds": (0..rng.below(3)).map(|_| if opts.is_empty() || rng.chance(5) { "calm".to_string() } else { rng.pick(opts).clone() }).collect::<Vec<_>>()}),
                5 => json!({"check": "links", "itemId": random_id(rng, &ids.items)}),
                _ => json!({"check": "empty"}),
            };
            // mostly use a test that suits the field, sometimes a wrong one on purpose
            let _ = kind;
            json!({"kind": "field", "fieldId": id, "test": test, "not": not})
        }
    }
}

fn random_group(rng: &mut Rng, ids: &Ids, depth: usize) -> Json {
    let rules: Vec<Json> = (0..rng.below(5)).map(|_| if depth < 3 && rng.chance(5) { random_group(rng, ids, depth + 1) } else { random_rule(rng, ids) }).collect();
    json!({"op": if rng.chance(2) { "all" } else { "any" }, "not": rng.chance(4), "rules": rules})
}

fn random_sort(rng: &mut Rng, ids: &Ids) -> Json {
    let mut keys: Vec<Json> = Vec::new();
    let mut used = HashSet::new();
    for _ in 0..rng.below(4) {
        let dir = if rng.chance(2) { "asc" } else { "desc" };
        let key = match rng.below(6) {
            0 => json!({"by": "name", "dir": dir}),
            1 => json!({"by": "created", "dir": dir}),
            2 => json!({"by": "updated", "dir": dir}),
            3 => json!({"by": "type", "dir": dir}),
            _ => json!({"by": "field", "fieldId": ids.fields[rng.below(ids.fields.len())].0, "dir": dir}),
        };
        if used.insert(key["by"].to_string() + &key["fieldId"].to_string()) {
            keys.push(key);
        }
    }
    Json::Array(keys)
}

#[test]
fn the_sql_agrees_with_the_slow_evaluator_on_thousands_of_random_questions() {
    let mut checked = 0;
    let mut non_empty = 0;
    for seed in 1..=40u64 {
        let mut rng = Rng(seed * 7919);
        let (fx, ids) = build_world(&mut rng);
        let world = World::load(&fx.conn, NOW);
        for n in 0..80 {
            let query = json!({"version": 1, "where": random_group(&mut rng, &ids, 1), "sort": random_sort(&mut rng, &ids)});
            let parsed = from_value(query.clone()).unwrap_or_else(|e| panic!("seed {seed} query {n}: {e}\n{query}"));
            let only = if rng.chance(8) { Some("document") } else { None };
            let got: Vec<String> = run(&fx.conn, &fx.camp, &parsed, NOW, only).unwrap_or_else(|e| panic!("seed {seed} query {n}: {e}\n{query}")).items.into_iter().map(|i| i.id).collect();
            let want = world.expected(&parsed, only);
            assert_eq!(got, want, "seed {seed} query {n}\n{query}");
            checked += 1;
            if !want.is_empty() {
                non_empty += 1;
            }
        }
    }
    assert_eq!(checked, 3200);
    assert!(non_empty > 1500, "the random questions should find something often enough to mean something: {non_empty}");
}
