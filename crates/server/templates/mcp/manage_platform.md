{%- if action == "create_project" %}
# Created project `{{ slug.as_deref().unwrap_or("") }}`
- Name: {{ name.as_deref().unwrap_or("") }}
- Project ID: {% if let Some(pid) = project_id %}{{ pid }}{% endif %}
{%- else if action == "issue_api_key" %}
# Issued API key `{{ name.as_deref().unwrap_or("") }}`
- Key ID: {% if let Some(kid) = api_key_id %}{{ kid }}{% endif %}
- Token: `{{ api_key.as_deref().unwrap_or("") }}`
- Global: {{ is_global.unwrap_or(false) }}{% if let Some(Some(p)) = project %} | Project: {{ p }}{% endif %}
- Scopes: {{ scopes_csv() }}
- Warning: {{ warning.as_deref().unwrap_or("") }}
{%- else if action == "revoke_api_key" %}
# Revoked API key `{% if let Some(kid) = api_key_id %}{{ kid }}{% endif %}`
- Revoked: {{ revoked.unwrap_or(true) }}
{%- else if action == "list_users" %}
# Users ({{ users.as_ref().map(Vec::len).unwrap_or(0) }})
{%- if let Some(list) = users %}
{%- for u in list %}
- `{{ u.username }}` ({{ u.role }}) — {{ u.display_name }} [{{ u.id }}]
{%- endfor %}
{%- endif %}
{%- endif %}
