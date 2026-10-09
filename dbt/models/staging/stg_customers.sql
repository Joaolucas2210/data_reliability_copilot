select customer_id, segment, region, created_at::date as created_at, _batch_id, _loaded_at
from {{ source('raw', 'customers') }}
