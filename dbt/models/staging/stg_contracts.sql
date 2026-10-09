select contract_id, customer_id, principal::numeric(14,2) as principal, rate_monthly::numeric(8,6) as rate_monthly,
       n_installments, start_date::date as start_date, status, _batch_id, _loaded_at
from {{ source('raw', 'contracts') }}
