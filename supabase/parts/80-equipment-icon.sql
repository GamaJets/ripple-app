-- The picture a row gets when the movement has no illustration.
--
-- Three rows in the catalogue are pieces of equipment rather than movements —
-- Cable Machine, Ski Erg, Smith Machine — so the pack that illustrates
-- exercises has nothing for them, and they were the only rows in six hundred
-- showing an empty tile. The pack DOES ship 74 equipment icons, which is
-- exactly the right picture for a row that names a machine.
--
-- A separate column rather than another entry in image_paths, because the two
-- are not the same claim. image_paths are frames OF THE MOVEMENT and the
-- screen cross-fades them as a demonstration; an equipment icon is a picture
-- of the kit and must be labelled as one. Putting it in image_paths would
-- animate a static machine and caption it as a person performing a lift.
alter table public.exercises
  add column if not exists equipment_icon_path text;

comment on column public.exercises.equipment_icon_path is
  'Storage key in the exercise-demos bucket for a picture of the equipment, shown only where there is no illustration of the movement itself. Never a demonstration.';
