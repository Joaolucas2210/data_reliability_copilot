-- One row per payment as delivered by ingestion. NOTE: no deduplication here (see benchmark DUP-*).
select payment_id, installment_id, paid_at::timestamp as paid_at, amount::numeric(14,2) as amount,
       channel, _batch_id, _loaded_at
from {{ source('raw', 'payments') }}
