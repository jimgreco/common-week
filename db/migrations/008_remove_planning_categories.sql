-- Plans and tasks no longer use categories. Remove the association first so
-- PostgreSQL can release its foreign key before the category catalog itself.
alter table planning_items
  drop column category_id;

drop table categories;
