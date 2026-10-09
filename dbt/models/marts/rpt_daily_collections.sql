-- Business report consumed by finance: collections per day.
select paid_date as business_date,
       count(*)::bigint as payments_count,
       sum(amount)::numeric(16,2) as collected_amount,
       count(distinct contract_id)::bigint as contracts_paid
from {{ ref('fct_payments') }}
group by paid_date
