-- The name generator is gone (Phase 4b, stage 7): its saved setups (`name_preset` items) only
-- made sense there. The items go (their links and tag links follow through ON DELETE CASCADE,
-- and the search triggers on `items` clean the index), then the detail table is dropped.
-- Migration 0018 is never edited: it has already run on databases.
DELETE FROM items WHERE library = 'tables' AND item_type = 'name_preset';

DROP TABLE name_presets;
