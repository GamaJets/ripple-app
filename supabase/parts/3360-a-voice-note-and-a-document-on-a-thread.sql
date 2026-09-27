-- ═══════════════════════════════════════════════════════════════════════════
-- Two more things a coach and a client hand each other: a voice note, and a
-- document.
--
-- ── What part 124 built, and what it left out ────────────────────────────
--
-- `messages.attachment_kind` has been `in ('image', 'video')` since part 124,
-- and the bucket accepts four mime types: JPEG, PNG, MP4, QuickTime. That was
-- the right first pair — "a photo of the machine" is the thing that screen was
-- written for.
--
-- It leaves two everyday acts of coaching with nowhere to go:
--
--   A VOICE NOTE. Explaining why a knee is caving takes forty seconds to say
--   and four paragraphs to type, and a coach on a gym floor between clients
--   types neither. Every messaging product a coach already uses has this; ours
--   answered with a text box.
--
--   A DOCUMENT. A client's blood panel, a physio's report, a gym's induction
--   PDF. app/(trainer)/chat.tsx already DRAWS the file-card shape — it was
--   built from the board, where the card reads "Week 4 Plan.pdf" — and until
--   now nothing could ever fill it, because a PDF picked from a phone was
--   refused by `attachmentKindFor` and would have been refused by the bucket
--   behind it.
--
-- ── What a file may be, and what it may not ──────────────────────────────
--
-- The mime list stays a real limit rather than a default, for part 124's
-- reason. Four more types and no more:
--
--   audio/m4a and audio/mpeg — what expo-audio records on iOS and Android.
--   application/pdf — the document people actually send each other.
--   text/plain — a note exported from somewhere else, and the one plain format
--     that cannot carry anything executable.
--
-- NOT office documents, not archives, not anything else. A .docx is a zip, a
-- zip is a container, and a container is a thing this app would be handing
-- between two people's phones without being able to say what is in it. A coach
-- who needs to send one has email; the refusal says so.
--
-- ── The name is stored, and it is the sender's ───────────────────────────
--
-- A photo needs no name. A document does: "the file your coach sent" is not
-- something anybody can act on, and the name is how a person decides whether
-- to open it. So `attachment_name` is added — nullable, because the first two
-- kinds have never needed one and a name invented from a storage key
-- ("1738-x9.pdf") is worse than none.
--
-- It is the ONE piece of attacker-controlled text this table will render, so
-- it is capped and it is the app's job to draw it as text and never as
-- anything else. The cap is 120 characters, which is longer than any real
-- document name and short enough that it cannot be used as a message body
-- that bypasses the body's own rules.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.messages add column if not exists attachment_name text;

alter table public.messages drop constraint if exists messages_attachment_name_chk;
alter table public.messages add constraint messages_attachment_name_chk
  check (attachment_name is null or char_length(attachment_name) <= 120);

comment on column public.messages.attachment_name is
  'The sender''s own filename, for the kinds where a name is how you decide whether to open it (file, and nothing else today). Null for a photo, a video or a voice note, where the name would be a storage key nobody wrote. Capped at 120 characters: it is the one piece of sender-controlled text drawn beside a message, and a screen renders it as text and never as anything else.';

-- The two new kinds. Written as a replacement of the whole constraint rather
-- than an addition, because a check constraint is one expression and the list
-- of what an attachment may BE belongs in one place.
alter table public.messages drop constraint if exists messages_attachment_kind_chk;
alter table public.messages add constraint messages_attachment_kind_chk
  check (attachment_kind is null or attachment_kind in ('image', 'video', 'audio', 'file'));

-- Four more mime types, and no more. See the header for why the list is short
-- and why a .docx is not on it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-media', 'message-media', false, 67108864,
        array['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime',
              'audio/m4a', 'audio/mpeg', 'application/pdf', 'text/plain'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The object policies are unchanged and deliberately so: they match on the
-- thread id in the first path segment and the uploader's uid in the second,
-- and neither of those depends on what the file IS. A voice note is on a
-- thread exactly as a photo is, it stops being readable at the same moment,
-- and it is deleted by the same sweep.
