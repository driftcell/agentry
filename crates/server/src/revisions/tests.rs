use super::*;

#[test]
fn state_machine_only_allows_documented_transitions() {
    let all = [
        RevisionStatus::PendingReview,
        RevisionStatus::Approved,
        RevisionStatus::Rejected,
        RevisionStatus::Conflict,
        RevisionStatus::Active,
        RevisionStatus::Superseded,
    ];
    let allowed = [
        (RevisionStatus::PendingReview, RevisionStatus::Approved),
        (RevisionStatus::PendingReview, RevisionStatus::Rejected),
        (RevisionStatus::Conflict, RevisionStatus::PendingReview),
        (RevisionStatus::Conflict, RevisionStatus::Rejected),
        (RevisionStatus::Approved, RevisionStatus::Active),
        (RevisionStatus::Active, RevisionStatus::Superseded),
    ];
    for from in all {
        for to in all {
            assert_eq!(
                from.can_transition_to(to),
                allowed.contains(&(from, to)),
                "unexpected transition {from:?} -> {to:?}"
            );
        }
    }
}

#[test]
fn status_round_trips_through_database_strings() {
    for status in [
        RevisionStatus::PendingReview,
        RevisionStatus::Approved,
        RevisionStatus::Rejected,
        RevisionStatus::Conflict,
        RevisionStatus::Active,
        RevisionStatus::Superseded,
    ] {
        assert_eq!(RevisionStatus::parse(status.as_str()), Some(status));
    }
    assert_eq!(RevisionStatus::parse("nonsense"), None);
}

#[tokio::test]
async fn real_three_way_merge_succeeds_for_disjoint_edits() {
    // This test exercises diffy directly with the exact function used by
    // the domain; it is a unit-level merge correctness check.
    let base = "line one\nline two\nline three\nline four\nline five\n";
    let ours = "line one\nline two\nline three changed by active\nline four\nline five\n";
    let theirs = "line one changed\nline two\nline three\nline four\nline five\n";
    let merged = diffy::merge(base, ours, theirs);
    assert!(merged.is_ok());
    let merged = merged.unwrap();
    assert!(merged.contains("line one changed"));
    assert!(merged.contains("line three changed by active"));
    assert!(merged.contains("line one changed"));
}

#[tokio::test]
async fn real_three_way_merge_reports_overlap() {
    let base = "line one\n";
    let ours = "active version\n";
    let theirs = "incoming version\n";
    let merged = diffy::merge(base, ours, theirs);
    assert!(merged.is_err());
    assert!(merged.unwrap_err().contains("<<<<<<<"));
}
