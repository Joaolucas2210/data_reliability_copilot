select p.payment_id, p.installment_id, i.contract_id, c.customer_id, p.paid_at, p.paid_at::date as paid_date,
       p.amount, p.channel, p._batch_id
from {{ ref('stg_payments') }} p
join {{ ref('stg_installments') }} i using (installment_id)
join {{ ref('stg_contracts') }} c using (contract_id)
