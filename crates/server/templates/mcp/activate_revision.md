# Activated `{{ revision_id }}` ({{ project }})
- Status: {{ status }}
{%- if let Some(at) = activated_at %}
- Activated at: {{ at }}
{%- endif %}
