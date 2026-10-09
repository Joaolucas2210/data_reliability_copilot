-- Playbook dedupe_payments: one row per payment_id, keeping the earliest load (first delivery wins).
select payment_id, installment_id, paid_at, amount, channel, _batch_id, _loaded_at
from (
    select payment_id, installment_id, paid_at::timestamp as paid_at, amount::numeric(14,2) as amount,
           channel, _batch_id, _loaded_at,
           row_number() over (partition by payment_id order by _loaded_at, _batch_id) as rn
    from {{ source('raw', 'payments') }}
) p
where rn = 1
