-- ZION-ADM | BLOCO 1 | Receita manual mensal (piloto)
-- Apenas declaracao administrativa de receita em BRL, por competencia.
-- Valor zero precisa ser confirmado; ausencia de linha significa desconhecido.
-- Nao cria planos, cobranca, pagamentos, faturas ou fechamento definitivo.
BEGIN;

CREATE TABLE public.zion_admin_monthly_manual_revenue (
    month date PRIMARY KEY,
    amount_brl_cents bigint NOT NULL
      CHECK (amount_brl_cents BETWEEN 0 AND 100000000000),
    revision integer NOT NULL CHECK (revision >= 1),
    created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    CONSTRAINT zamr_month_check CHECK (month = pg_catalog.date_trunc('month', month::timestamp)::date)
);

CREATE TABLE public.zion_admin_monthly_manual_revenue_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    month date NOT NULL REFERENCES public.zion_admin_monthly_manual_revenue(month) ON DELETE RESTRICT,
    revision integer NOT NULL CHECK (revision >= 1),
    amount_brl_cents bigint NOT NULL CHECK (amount_brl_cents BETWEEN 0 AND 100000000000),
    expected_revision integer NOT NULL CHECK (expected_revision >= 0),
    operation_key uuid NOT NULL UNIQUE,
    actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    CONSTRAINT zamra_month_revision_unique UNIQUE(month, revision)
);

-- Audit append-only: bloqueia alteracao, remocao e limpeza total.
CREATE FUNCTION public.zion_admin_reject_manual_revenue_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'ZION_ADMIN_MANUAL_REVENUE_AUDIT_IMMUTABLE';
END;
$function$;

CREATE TRIGGER zamra_no_update_delete
BEFORE UPDATE OR DELETE ON public.zion_admin_monthly_manual_revenue_audit
FOR EACH ROW EXECUTE FUNCTION public.zion_admin_reject_manual_revenue_audit_mutation();

CREATE TRIGGER zamra_no_truncate
BEFORE TRUNCATE ON public.zion_admin_monthly_manual_revenue_audit
FOR EACH STATEMENT EXECUTE FUNCTION public.zion_admin_reject_manual_revenue_audit_mutation();

-- Writer transacional: idempotencia, concorrencia e revisao esperada.
CREATE FUNCTION public.zion_admin_set_manual_monthly_revenue_by_system(
  p_month date,
  p_amount_brl_cents bigint,
  p_expected_revision integer,
  p_operation_key uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_current public.zion_admin_monthly_manual_revenue%ROWTYPE;
  v_prior public.zion_admin_monthly_manual_revenue_audit%ROWTYPE;
  v_revision integer;
  v_outcome text;
  v_today_month date;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ZION_ADMIN_MANUAL_REVENUE_UNAUTHORIZED';
  END IF;

  v_today_month := pg_catalog.date_trunc('month',
    pg_catalog.timezone('America/Sao_Paulo', pg_catalog.clock_timestamp()))::date;

  IF p_month IS NULL
    OR p_month < DATE '2020-01-01'
    OR p_month > v_today_month
    OR p_month <> pg_catalog.date_trunc('month', p_month::timestamp)::date
  THEN
    RAISE EXCEPTION 'ZION_ADMIN_MANUAL_REVENUE_INVALID_MONTH';
  END IF;

  IF p_amount_brl_cents IS NULL OR p_amount_brl_cents < 0
    OR p_amount_brl_cents > 100000000000
  THEN
    RAISE EXCEPTION 'ZION_ADMIN_MANUAL_REVENUE_INVALID_AMOUNT';
  END IF;

  IF p_expected_revision IS NULL OR p_expected_revision < 0
    OR p_operation_key IS NULL OR p_actor_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_actor_id)
  THEN
    RAISE EXCEPTION 'ZION_ADMIN_MANUAL_REVENUE_INVALID_OPERATION';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('zion_admin_monthly_manual_revenue'),
    pg_catalog.hashtext(p_month::text)
  );

  -- Reenvio seguro: nunca gera outra revisao para a mesma operacao.
  SELECT * INTO v_prior
  FROM public.zion_admin_monthly_manual_revenue_audit
  WHERE operation_key = p_operation_key;

  IF FOUND THEN
    IF v_prior.month IS DISTINCT FROM p_month
      OR v_prior.amount_brl_cents IS DISTINCT FROM p_amount_brl_cents
      OR v_prior.expected_revision IS DISTINCT FROM p_expected_revision
      OR v_prior.actor_id IS DISTINCT FROM p_actor_id
    THEN
      RAISE EXCEPTION 'ZION_ADMIN_MANUAL_REVENUE_OPERATION_REUSED';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'outcome', 'replayed', 'month', p_month,
      'amountBrlCents', v_prior.amount_brl_cents,
      'revision', v_prior.revision
    );
  END IF;

  -- Nao editar competencia que ja foi definitivamente fechada.
  IF EXISTS (
    SELECT 1 FROM public.zion_admin_monthly_final_closures
    WHERE month = p_month
  ) THEN
    RAISE EXCEPTION 'ZION_ADMIN_MANUAL_REVENUE_MONTH_FINALIZED';
  END IF;

  SELECT * INTO v_current
  FROM public.zion_admin_monthly_manual_revenue
  WHERE month = p_month
  FOR UPDATE;

  IF FOUND THEN
    IF p_expected_revision <> v_current.revision THEN
      RAISE EXCEPTION 'ZION_ADMIN_MANUAL_REVENUE_STALE_REVISION';
    END IF;
    IF p_amount_brl_cents = v_current.amount_brl_cents THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', true, 'outcome', 'unchanged', 'month', p_month,
        'amountBrlCents', v_current.amount_brl_cents,
        'revision', v_current.revision
      );
    END IF;
    v_revision := v_current.revision + 1;
    UPDATE public.zion_admin_monthly_manual_revenue
    SET amount_brl_cents = p_amount_brl_cents,
        revision = v_revision,
        updated_by = p_actor_id,
        updated_at = pg_catalog.clock_timestamp()
    WHERE month = p_month;
    v_outcome := 'revised';
  ELSE
    IF p_expected_revision <> 0 THEN
      RAISE EXCEPTION 'ZION_ADMIN_MANUAL_REVENUE_STALE_REVISION';
    END IF;
    v_revision := 1;
    INSERT INTO public.zion_admin_monthly_manual_revenue (
      month, amount_brl_cents, revision, created_by, updated_by
    ) VALUES (
      p_month, p_amount_brl_cents, 1, p_actor_id, p_actor_id
    );
    v_outcome := 'created';
  END IF;

  INSERT INTO public.zion_admin_monthly_manual_revenue_audit (
    month, revision, amount_brl_cents, expected_revision,
    operation_key, actor_id
  ) VALUES (
    p_month, v_revision, p_amount_brl_cents, p_expected_revision,
    p_operation_key, p_actor_id
  );

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'outcome', v_outcome, 'month', p_month,
    'amountBrlCents', p_amount_brl_cents, 'revision', v_revision
  );
END;
$function$;

ALTER TABLE public.zion_admin_monthly_manual_revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zion_admin_monthly_manual_revenue_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.zion_admin_monthly_manual_revenue FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.zion_admin_monthly_manual_revenue_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.zion_admin_monthly_manual_revenue TO service_role;
GRANT SELECT ON TABLE public.zion_admin_monthly_manual_revenue_audit TO service_role;
REVOKE ALL ON SEQUENCE public.zion_admin_monthly_manual_revenue_audit_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zion_admin_set_manual_monthly_revenue_by_system(date,bigint,integer,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zion_admin_set_manual_monthly_revenue_by_system(date,bigint,integer,uuid,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.zion_admin_reject_manual_revenue_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
