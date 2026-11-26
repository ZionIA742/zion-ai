-- CRM catalog search relevance improvement.
-- Replaces the previous function without changing its contract.
-- Exact names and SKUs take priority over descriptive matches.

-- CRM catalog: store-scoped lightweight search.
-- No photo reads, storage operations or data mutations.

BEGIN;

CREATE OR REPLACE FUNCTION public.crm_search_catalog_products(
    p_organization_id uuid,
    p_store_id uuid,
    p_query text,
    p_category text,
    p_page integer
)
RETURNS TABLE (
    source_kind text,
    source_id uuid,
    name text,
    sku text,
    category text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$

WITH input_args AS (
    SELECT
        translate(
            lower(btrim(coalesce(p_query, ''))),
            U&'\00E1\00E0\00E2\00E3\00E4\00E9\00E8\00EA\00EB\00ED\00EC\00EE\00EF\00F3\00F2\00F4\00F5\00F6\00FA\00F9\00FB\00FC\00E7\00F1',
            'aaaaaeeeeiiiiooooouuuucn'
        ) AS search_term
    WHERE
        p_organization_id IS NOT NULL
        AND p_store_id IS NOT NULL
        AND p_page BETWEEN 0 AND 10000
        AND char_length(coalesce(p_query, '')) <= 120
        AND (
            p_category IS NULL
            OR p_category IN (
                'piscinas',
                'quimicos',
                'acessorios',
                'outros'
            )
        )
),

catalog_entries AS (
    SELECT
        'pool'::text AS source_kind,
        p.id AS source_id,
        btrim(p.name)::text AS name,
        NULL::text AS sku,
        'piscinas'::text AS category,
        concat_ws(
            ' ',
            p.name,
            p.description,
            p.material,
            p.shape,
            p.width_m::text || ' metros',
            p.length_m::text || ' metros',
            p.depth_m::text || ' metros',
            p.max_capacity_l::text || ' litros',
            p.weight_kg::text || ' kg',
            'piscinas'
        ) AS search_content
    FROM public.pools AS p
    WHERE
        p.organization_id = p_organization_id
        AND p.store_id = p_store_id
        AND p.is_active IS TRUE
        AND nullif(btrim(p.name), '') IS NOT NULL
        AND (
            p_category IS NULL
            OR p_category = 'piscinas'
        )

    UNION ALL

    SELECT
        'catalog_item'::text AS source_kind,
        i.id AS source_id,
        btrim(i.name)::text AS name,
        nullif(btrim(i.sku), '')::text AS sku,
        CASE
            WHEN i.metadata->>'categoria' = 'quimicos'
                THEN 'quimicos'
            WHEN i.metadata->>'categoria' = 'acessorios'
                THEN 'acessorios'
            ELSE 'outros'
        END::text AS category,
        concat_ws(
            ' ',
            i.name,
            i.sku,
            i.description,
            i.metadata->>'brand',
            i.metadata->>'model',
            i.metadata->>'line',
            i.metadata->>'material',
            i.metadata->>'color',
            i.metadata->>'dimensions',
            i.metadata->>'width_cm',
            i.metadata->>'height_cm',
            i.metadata->>'length_cm',
            i.metadata->>'weight_kg',
            i.metadata->>'weight',
            i.metadata->>'capacity',
            i.metadata->>'size',
            i.metadata->>'size_details',
            i.metadata->>'unit_label',
            i.metadata->>'application',
            i.metadata->>'usage',
            i.metadata->>'composition',
            i.metadata->>'dosage',
            i.metadata->>'dosagem',
            i.metadata->>'concentration',
            i.metadata->>'packaging',
            i.metadata->>'embalagem',
            i.metadata->>'compatibility',
            i.metadata->>'function',
            i.metadata->>'barcode',
            CASE
                WHEN i.metadata->>'categoria' = 'quimicos'
                    THEN 'produtos quimicos'
                WHEN i.metadata->>'categoria' = 'acessorios'
                    THEN 'acessorios'
                ELSE 'outros'
            END
        ) AS search_content
    FROM public.store_catalog_items AS i
    WHERE
        i.organization_id = p_organization_id
        AND i.store_id = p_store_id
        AND i.is_active IS TRUE
        AND nullif(btrim(i.name), '') IS NOT NULL
        AND (
            p_category IS NULL
            OR p_category <> 'piscinas'
        )
),

normalized_entries AS (
    SELECT
        e.source_kind,
        e.source_id,
        e.name,
        e.sku,
        e.category,
        translate(
            lower(e.name),
            U&'\00E1\00E0\00E2\00E3\00E4\00E9\00E8\00EA\00EB\00ED\00EC\00EE\00EF\00F3\00F2\00F4\00F5\00F6\00FA\00F9\00FB\00FC\00E7\00F1',
            'aaaaaeeeeiiiiooooouuuucn'
        ) AS search_name,
        translate(
            lower(coalesce(e.sku, '')),
            U&'\00E1\00E0\00E2\00E3\00E4\00E9\00E8\00EA\00EB\00ED\00EC\00EE\00EF\00F3\00F2\00F4\00F5\00F6\00FA\00F9\00FB\00FC\00E7\00F1',
            'aaaaaeeeeiiiiooooouuuucn'
        ) AS search_sku,
        translate(
            lower(e.search_content),
            U&'\00E1\00E0\00E2\00E3\00E4\00E9\00E8\00EA\00EB\00ED\00EC\00EE\00EF\00F3\00F2\00F4\00F5\00F6\00FA\00F9\00FB\00FC\00E7\00F1',
            'aaaaaeeeeiiiiooooouuuucn'
        ) AS search_content
    FROM catalog_entries AS e
    WHERE
        p_category IS NULL
        OR e.category = p_category
)

SELECT
    e.source_kind,
    e.source_id,
    e.name,
    e.sku,
    e.category
FROM normalized_entries AS e
CROSS JOIN input_args AS a
WHERE NOT EXISTS (
    SELECT 1
    FROM regexp_split_to_table(
        a.search_term,
        '[[:space:]]+'
    ) AS token(value)
    WHERE
        token.value <> ''
        AND strpos(
            e.search_content,
            token.value
        ) = 0
)
ORDER BY
    CASE
        WHEN a.search_term = '' THEN 0
        WHEN e.search_name = a.search_term
          OR e.search_sku = a.search_term THEN 0
        WHEN strpos(e.search_name, a.search_term) = 1 THEN 1
        WHEN strpos(e.search_name, a.search_term) > 0 THEN 2
        WHEN strpos(e.search_sku, a.search_term) > 0 THEN 3
        ELSE 4
    END,
    lower(e.name),
    e.source_kind,
    e.source_id
LIMIT 101
OFFSET (
    CASE
        WHEN p_page BETWEEN 0 AND 10000
            THEN p_page * 100
        ELSE 0
    END
);

$function$;

REVOKE ALL ON FUNCTION public.crm_search_catalog_products(
    uuid, uuid, text, text, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crm_search_catalog_products(
    uuid, uuid, text, text, integer
) TO service_role;

COMMIT;
