/** The one statement behind pagePersonsByIds (CR-ORG-CONTRACT-004), kept apart so person-read.ts stays small. */
// $1 ids, $2 escaped term|null, $3 limit, $4 offset|null, $5 focus id|null. Always ONE row.
export const PAGE_PERSONS_SQL = `with req as (
       select distinct u.id from unnest($1::uuid[]) as u(id)
     ), named as (
       select r.id, p.full_name, p.status, p.auth_user_id::text as auth_user_id,
              lower(coalesce(p.full_name, r.id::text)) as sort_key
         from req r left join org.person p on p.id = r.id
     ), matched as (
       select n.*, row_number() over (order by n.sort_key, n.id) - 1 as pos,
              count(*) over () as total
         from named n
        where $2::text is null or n.sort_key like '%' || lower($2::text) || '%' escape '\\'
     ), meta as (
       select coalesce(max(total), 0) as total,
              (select pos from matched where id = $5::uuid) as focus_pos
         from matched
     ), used as (
       select total,
              case
                when total = 0 then 0
                when coalesce($4::bigint, (focus_pos / $3::int) * $3::int, 0) >= total
                  then ((total - 1) / $3::int) * $3::int
                else coalesce($4::bigint, (focus_pos / $3::int) * $3::int, 0)
              end as off
         from meta
     )
     select u.total::int as total, u.off::int as "offset",
            coalesce((select json_agg(json_build_object(
                        'personId', m.id::text, 'fullName', m.full_name,
                        'status', m.status, 'authUserId', m.auth_user_id) order by m.pos)
                        from matched m
                       where m.pos >= u.off and m.pos < u.off + $3::int), '[]'::json) as rows
       from used u`;
