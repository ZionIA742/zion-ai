BEGIN;

-- ZION-ADM / 8-B
-- Ledger de despesas variaveis manuais.
-- Migration aditiva.
-- Nao altera dados existentes.

CREATE TABLE public.zion_admin_variable_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  idempotency_key text NOT NULL UNIQUE,

  name text NOT NULL,
  category text NOT NULL,
  description text,

  amount_minor bigint NOT NULL,
  currency text NOT NULL,

  expense_date date NOT NULL,
  competence_month date NOT NULL,

  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'active',

  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,

  created_at timestamptz NOT NULL
    DEFAULT now(),
  updated_at timestamptz NOT NULL
    DEFAULT now(),

  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,

  CONSTRAINT zav_name_check
    CHECK (
      char_length(btrim(name)) BETWEEN 1 AND 100
    ),

  CONSTRAINT zav_category_check
    CHECK (
      char_length(btrim(category)) BETWEEN 1 AND 80
    ),

  CONSTRAINT zav_description_check
    CHECK (
      description IS NULL OR
      char_length(description) <= 2000
    ),

  CONSTRAINT zav_idempotency_check
    CHECK (
      char_length(idempotency_key)
      BETWEEN 8 AND 200
    ),

  CONSTRAINT zav_amount_check
    CHECK (
      amount_minor > 0
      AND amount_minor <= 100000000000
    ),

  CONSTRAINT zav_currency_check
    CHECK (currency IN ('BRL', 'USD')),

  CONSTRAINT zav_source_check
    CHECK (source = 'manual'),

  CONSTRAINT zav_status_check
    CHECK (status IN ('active', 'cancelled')),

  CONSTRAINT zav_competence_check
    CHECK (
      competence_month =
      date_trunc(
        'month',
        expense_date::timestamp
      )::date
    ),

  CONSTRAINT zav_cancel_check
    CHECK (
      (
        status = 'active'
        AND cancelled_at IS NULL
        AND cancelled_by IS NULL
      )
      OR
      (
        status = 'cancelled'
        AND cancelled_at IS NOT NULL
        AND cancelled_by IS NOT NULL
      )
    )
);

CREATE INDEX zav_month_status_idx
ON public.zion_admin_variable_expenses (
  competence_month,
  status
);

CREATE INDEX zav_expense_date_idx
ON public.zion_admin_variable_expenses (
  expense_date
);

CREATE INDEX zav_category_month_idx
ON public.zion_admin_variable_expenses (
  category,
  competence_month,
  status
);


-- Historico imutavel das operacoes.

CREATE TABLE public.zion_admin_variable_expense_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  expense_id uuid NOT NULL
    REFERENCES public.zion_admin_variable_expenses(id)
    ON DELETE RESTRICT,

  operation_key text NOT NULL UNIQUE,

  action text NOT NULL,

  request_data jsonb NOT NULL,
  before_data jsonb,
  after_data jsonb NOT NULL,

  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL
    DEFAULT now(),

  CONSTRAINT zava_action_check
    CHECK (
      action IN ('created', 'edited', 'cancelled')
    ),

  CONSTRAINT zava_operation_key_check
    CHECK (
      char_length(operation_key)
      BETWEEN 8 AND 200
    )
);

CREATE INDEX zava_expense_created_idx
ON public.zion_admin_variable_expense_audit (
  expense_id,
  created_at
);


-- Bloqueia UPDATE e DELETE do historico.

CREATE FUNCTION
public.zion_admin_refuse_variable_expense_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'VARIABLE_EXPENSE_AUDIT_IMMUTABLE';
END;
$$;

CREATE TRIGGER
zion_admin_variable_expense_audit_immutable
BEFORE UPDATE OR DELETE
ON public.zion_admin_variable_expense_audit
FOR EACH ROW
EXECUTE FUNCTION
public.zion_admin_refuse_variable_expense_audit_mutation();


-- RPC unica para criar, editar e cancelar.
-- A rota administrativa devera obter p_actor_id
-- da sessao validada no servidor.
-- Nunca aceitar actor_id enviado diretamente
-- pelo navegador como identidade confiavel.

CREATE FUNCTION
public.zion_admin_mutate_variable_expense(
  p_action text,
  p_operation_key text,
  p_expense_id uuid,
  p_name text,
  p_category text,
  p_description text,
  p_amount_minor bigint,
  p_currency text,
  p_expense_date date,
  p_competence_month date,
  p_expected_updated_at timestamptz,
  p_reason text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_month date;
  v_before public.zion_admin_variable_expenses%ROWTYPE;
  v_after public.zion_admin_variable_expenses%ROWTYPE;
  v_prior public.zion_admin_variable_expense_audit%ROWTYPE;

  v_request jsonb;
  v_before_json jsonb;
  v_now timestamptz;

  v_name text;
  v_category text;
  v_description text;
  v_reason text;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_ACTOR_REQUIRED';
  END IF;

  IF p_action IS NULL
     OR p_action NOT IN (
       'created', 'edited', 'cancelled'
     )
  THEN
    RAISE EXCEPTION 'VARIABLE_ACTION_INVALID';
  END IF;

  IF p_operation_key IS NULL
     OR char_length(p_operation_key)
        NOT BETWEEN 8 AND 200
     OR p_operation_key <> btrim(p_operation_key)
  THEN
    RAISE EXCEPTION 'OPERATION_KEY_INVALID';
  END IF;

  v_name := btrim(p_name);
  v_category := btrim(p_category);
  v_description := nullif(
    btrim(p_description),
    ''
  );
  v_reason := nullif(
    btrim(p_reason),
    ''
  );

  IF p_action IN ('created', 'edited') THEN

    IF v_name IS NULL
       OR char_length(v_name) NOT BETWEEN 1 AND 100
       OR v_category IS NULL
       OR char_length(v_category) NOT BETWEEN 1 AND 80
       OR (
         v_description IS NOT NULL
         AND char_length(v_description) > 2000
       )
       OR p_amount_minor IS NULL
       OR p_amount_minor <= 0
       OR p_amount_minor > 100000000000
       OR p_currency IS NULL
       OR p_currency NOT IN ('BRL', 'USD')
       OR p_expense_date IS NULL
       OR p_competence_month IS NULL
       OR p_competence_month <>
          date_trunc(
            'month',
            p_expense_date::timestamp
          )::date
    THEN
      RAISE EXCEPTION
        'VARIABLE_EXPENSE_FIELDS_INVALID';
    END IF;

  END IF;

  IF p_action = 'created' THEN

    IF p_expense_id IS NOT NULL THEN
      RAISE EXCEPTION
        'CREATE_EXPENSE_ID_MUST_BE_NULL';
    END IF;

    v_month := p_competence_month;

    v_request := pg_catalog.jsonb_build_object(
      'action', p_action,
      'name', v_name,
      'category', v_category,
      'description', v_description,
      'amount_minor', p_amount_minor,
      'currency', p_currency,
      'expense_date', p_expense_date,
      'competence_month', v_month,
      'actor_id', p_actor_id
    );

  ELSE

    IF p_expense_id IS NULL THEN
      RAISE EXCEPTION 'EXPENSE_ID_REQUIRED';
    END IF;

    SELECT competence_month
    INTO v_month
    FROM public.zion_admin_variable_expenses
    WHERE id = p_expense_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'VARIABLE_EXPENSE_NOT_FOUND';
    END IF;

    IF p_action = 'edited' THEN

      IF p_expected_updated_at IS NULL
         OR p_competence_month IS DISTINCT FROM v_month
      THEN
        RAISE EXCEPTION
          'EXPENSE_VERSION_OR_MONTH_INVALID';
      END IF;

      v_request := pg_catalog.jsonb_build_object(
        'action', p_action,
        'expense_id', p_expense_id,
        'name', v_name,
        'category', v_category,
        'description', v_description,
        'amount_minor', p_amount_minor,
        'currency', p_currency,
        'expense_date', p_expense_date,
        'competence_month', v_month,
        'expected_updated_at', p_expected_updated_at,
        'actor_id', p_actor_id
      );

    ELSE

      v_request := pg_catalog.jsonb_build_object(
        'action', p_action,
        'expense_id', p_expense_id,
        'reason', v_reason,
        'actor_id', p_actor_id
      );

    END IF;

  END IF;


  -- Mesmo lock consultivo do fechamento mensal.
  -- A verificacao do mes fechado ocorre
  -- obrigatoriamente depois da aquisicao.

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      'zion_admin_monthly_close'
    ),
    pg_catalog.hashtext(v_month::text)
  );


  -- Idempotencia de todas as operacoes.

  SELECT *
  INTO v_prior
  FROM public.zion_admin_variable_expense_audit
  WHERE operation_key = p_operation_key;

  IF FOUND THEN

    IF v_prior.action <> p_action
       OR v_prior.request_data <> v_request
    THEN
      RAISE EXCEPTION
        'OPERATION_KEY_REUSED_WITH_DIFFERENT_DATA';
    END IF;

    SELECT *
    INTO v_after
    FROM public.zion_admin_variable_expenses
    WHERE id = v_prior.expense_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'IDEMPOTENT_EXPENSE_NOT_FOUND';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'expense', pg_catalog.to_jsonb(v_after),
      'idempotent', true
    );

  END IF;


  -- Um fechamento definitivo nunca pode
  -- ser alterado por operacoes manuais.

  IF EXISTS (
    SELECT 1
    FROM public.zion_admin_monthly_closures
    WHERE month = v_month
  ) THEN
    RAISE EXCEPTION
      'VARIABLE_EXPENSE_MONTH_ALREADY_CLOSED';
  END IF;


  IF p_action = 'created' THEN

    INSERT INTO public.zion_admin_variable_expenses (
      idempotency_key,
      name,
      category,
      description,
      amount_minor,
      currency,
      expense_date,
      competence_month,
      source,
      status,
      created_by,
      updated_by
    )
    VALUES (
      p_operation_key,
      v_name,
      v_category,
      v_description,
      p_amount_minor,
      p_currency,
      p_expense_date,
      v_month,
      'manual',
      'active',
      p_actor_id,
      p_actor_id
    )
    RETURNING * INTO v_after;

    v_before_json := NULL;

  ELSE

    SELECT *
    INTO v_before
    FROM public.zion_admin_variable_expenses
    WHERE id = p_expense_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_before.competence_month <> v_month
    THEN
      RAISE EXCEPTION
        'VARIABLE_EXPENSE_CHANGED_DURING_OPERATION';
    END IF;

    IF v_before.status <> 'active' THEN
      RAISE EXCEPTION
        'VARIABLE_EXPENSE_NOT_ACTIVE';
    END IF;

    v_before_json := pg_catalog.to_jsonb(v_before);

    v_now := greatest(
      pg_catalog.clock_timestamp(),
      v_before.updated_at +
        interval '1 microsecond'
    );

    IF p_action = 'edited' THEN

      IF v_before.updated_at
         IS DISTINCT FROM p_expected_updated_at
      THEN
        RAISE EXCEPTION
          'VARIABLE_EXPENSE_STALE_VERSION';
      END IF;

      UPDATE public.zion_admin_variable_expenses
      SET
        name = v_name,
        category = v_category,
        description = v_description,
        amount_minor = p_amount_minor,
        currency = p_currency,
        expense_date = p_expense_date,
        updated_by = p_actor_id,
        updated_at = v_now
      WHERE id = p_expense_id
      RETURNING * INTO v_after;

    ELSE

      UPDATE public.zion_admin_variable_expenses
      SET
        status = 'cancelled',
        cancelled_at = v_now,
        cancelled_by = p_actor_id,
        cancel_reason = v_reason,
        updated_by = p_actor_id,
        updated_at = v_now
      WHERE id = p_expense_id
      RETURNING * INTO v_after;

    END IF;

  END IF;


  -- Auditoria atomica: se falhar,
  -- toda a mutacao sera revertida.

  INSERT INTO public.zion_admin_variable_expense_audit (
    expense_id,
    operation_key,
    action,
    request_data,
    before_data,
    after_data,
    actor_id
  )
  VALUES (
    v_after.id,
    p_operation_key,
    p_action,
    v_request,
    v_before_json,
    pg_catalog.to_jsonb(v_after),
    p_actor_id
  );

  RETURN pg_catalog.jsonb_build_object(
    'expense', pg_catalog.to_jsonb(v_after),
    'idempotent', false
  );
END;
$$;


-- Barreira temporaria de integridade:
-- o fechamento legado ainda nao contabiliza
-- despesas manuais.
-- Impedir que ele congele um total incorreto.

CREATE FUNCTION
public.zion_admin_guard_legacy_manual_closure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      'zion_admin_monthly_close'
    ),
    pg_catalog.hashtext(NEW.month::text)
  );

  IF EXISTS (
    SELECT 1
    FROM public.zion_admin_variable_expenses
    WHERE competence_month = NEW.month
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION
      'CLOSURE_REQUIRES_MANUAL_EXPENSE_INTEGRATION';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER
zion_admin_guard_legacy_manual_closure
BEFORE INSERT
ON public.zion_admin_monthly_closures
FOR EACH ROW
EXECUTE FUNCTION
public.zion_admin_guard_legacy_manual_closure();


-- Permissoes fail-closed.

ALTER TABLE
public.zion_admin_variable_expenses
ENABLE ROW LEVEL SECURITY;

ALTER TABLE
public.zion_admin_variable_expense_audit
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.zion_admin_variable_expenses,
  public.zion_admin_variable_expense_audit
FROM PUBLIC, anon, authenticated, service_role;

-- Somente leitura direta para a camada
-- server-side que utiliza service_role.
-- Mutacoes exclusivamente pela RPC.

GRANT SELECT ON TABLE
  public.zion_admin_variable_expenses,
  public.zion_admin_variable_expense_audit
TO service_role;

REVOKE ALL ON FUNCTION
public.zion_admin_mutate_variable_expense(
  text, text, uuid, text, text, text,
  bigint, text, date, date,
  timestamptz, text, uuid
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.zion_admin_mutate_variable_expense(
  text, text, uuid, text, text, text,
  bigint, text, date, date,
  timestamptz, text, uuid
)
TO service_role;

REVOKE ALL ON FUNCTION
public.zion_admin_refuse_variable_expense_audit_mutation()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
public.zion_admin_guard_legacy_manual_closure()
FROM PUBLIC, anon, authenticated;


COMMIT;
