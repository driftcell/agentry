
    use super::*;
use crate::workspace::*;

    #[test]
    fn kind_filters_are_explicit() {
        assert!(KindFilter::parse(None).unwrap() == KindFilter::All);
        assert!(KindFilter::parse(Some("skills")).unwrap() == KindFilter::Skills);
        assert!(KindFilter::parse(Some("nonsense")).is_err());
    }

    #[test]
    fn pagination_is_stable_and_rejects_bad_cursors() {
        let items: Vec<i32> = (0..5).collect();
        let (page, next) = paginate(&items, None, 2).unwrap();
        assert_eq!(page, vec![0, 1]);
        assert!(next.is_some());
        let (page2, next2) = paginate(&items, next.as_deref(), 2).unwrap();
        assert_eq!(page2, vec![2, 3]);
        let (page3, next3) = paginate(&items, next2.as_deref(), 2).unwrap();
        assert_eq!(page3, vec![4]);
        assert!(next3.is_none());
        assert!(paginate(&items, Some("not-base64!"), 2).is_err());
    }
