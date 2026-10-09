select installment_id, contract_id, seq, due_date::date as due_date, amount::numeric(14,2) as amount, _batch_id, _loaded_at
from {{ source('raw', 'installments') }}
