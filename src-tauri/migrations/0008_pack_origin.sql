-- Items that came from a content pack remember where: the pack's id and the
-- item's id inside the pack. Both are NULL for items made here. This is what
-- "update from original" will use later.
ALTER TABLE items ADD COLUMN origin_pack_id TEXT;
ALTER TABLE items ADD COLUMN origin_item_id TEXT;

CREATE INDEX items_by_origin ON items (origin_pack_id, origin_item_id)
    WHERE origin_pack_id IS NOT NULL;
