-- Выполните этот SQL в Supabase: Project → SQL Editor → New query → Run

create table if not exists families (
  id bigserial primary key,
  invite_code text unique not null
);

create table if not exists users (
  user_id bigint primary key,
  username text,
  first_name text,
  family_id bigint references families(id)
);

create table if not exists transactions (
  id bigserial primary key,
  family_id bigint not null references families(id),
  user_id bigint not null references users(user_id),
  amount numeric not null,
  type text not null check (type in ('expense', 'income')),
  category text not null,
  comment text,
  created_at bigint not null
);

create index if not exists idx_transactions_family on transactions(family_id);
create index if not exists idx_users_family on users(family_id);
