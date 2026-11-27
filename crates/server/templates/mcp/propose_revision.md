# Revision `{{ revision_id }}` [{{ status }}] ({{ project }})
- Commit: {{ commit_message }}
- Diff: +{{ token_added }} / -{{ token_removed }} tokens ({{ file_count }} files)
{%- if !conflicts.is_empty() %}
## Conflicts ({{ conflicts.len() }})
{%- for c in conflicts %}
- `{{ c.path }}` ({{ c.hunks }} hunks @ lines {{ c.lines_csv() }})
{%- endfor %}
{%- endif %}
- Next: {{ next }}
