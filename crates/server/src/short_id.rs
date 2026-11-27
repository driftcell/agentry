use std::fmt::Write as _;

use uuid::Uuid;

use crate::tokens::count_tokens;

/// 945 curated 4–6 letter English words verified against `o200k_base` so that
/// every word is strictly 1 token both standalone and with a leading space.
/// Combining two words with `-` yields 893,025 combinations per project and
/// strictly 3 tokens (vs. 18 tokens for a 36-character UUID).
pub const WORDS: &[&str] = &[
    "able", "acid", "acre", "aged", "airy", "alto", "amber", "anchor", "angle", "arch", "area",
    "army", "atom", "auto", "axis", "baby", "back", "badge", "bait", "ball", "band", "bane",
    "bang", "bank", "bare", "barn", "base", "bash", "bass", "bath", "beam", "bean", "bear", "beat",
    "beck", "been", "beer", "bell", "belt", "bend", "berg", "best", "beta", "bias", "bike", "bill",
    "bind", "bird", "bite", "blob", "blog", "blue", "blur", "boat", "body", "bold", "bolt", "bomb",
    "bond", "bone", "book", "boom", "boot", "born", "boss", "both", "bout", "bran", "brew", "grim",
    "buck", "buff", "bulk", "bull", "burn", "bury", "busy", "buzz", "byte", "cake", "call", "came",
    "camp", "cape", "card", "care", "cart", "case", "cash", "cast", "cell", "cent", "chai", "chap",
    "char", "chat", "chef", "chin", "chip", "cite", "city", "clam", "clip", "club", "coal", "coat",
    "code", "coil", "coin", "cold", "coma", "comb", "come", "cone", "cook", "cool", "coop", "cope",
    "copy", "cord", "core", "corn", "cost", "cran", "crew", "crib", "crop", "crow", "cube", "cult",
    "curl", "cute", "dale", "dark", "dart", "dash", "data", "date", "dead", "deal", "deck", "deep",
    "demo", "dent", "deny", "desk", "dial", "dice", "diet", "ding", "dire", "disc", "dish", "disk",
    "dock", "done", "doom", "door", "dose", "down", "drag", "dram", "draw", "drop", "drug", "dual",
    "duck", "duct", "dump", "dust", "each", "earn", "ease", "east", "easy", "echo", "edge", "edit",
    "elan", "else", "emit", "eras", "erne", "even", "ever", "evil", "exam", "exec", "exit", "expo",
    "eyes", "face", "fact", "fade", "fail", "fair", "fake", "fall", "fang", "fare", "farm", "fast",
    "feat", "feed", "feel", "fell", "felt", "fern", "fest", "file", "fill", "film", "find", "fine",
    "fire", "firm", "fish", "fits", "five", "flag", "flat", "flex", "flip", "flow", "flux", "foam",
    "foil", "fold", "folk", "fond", "font", "food", "foot", "ford", "fore", "fork", "form", "fort",
    "four", "free", "frog", "from", "fuel", "full", "fund", "funk", "gain", "game", "gang", "gate",
    "gave", "gear", "geld", "gelt", "gene", "gent", "geta", "gift", "girl", "gist", "give", "glob",
    "goal", "gold", "gone", "gong", "good", "grab", "grad", "gram", "gran", "gray", "grey", "grid",
    "grow", "gulp", "guru", "gust", "gyro", "hack", "haft", "hail", "hair", "hale", "half", "hall",
    "halo", "halt", "hand", "hang", "hard", "hare", "harm", "hart", "hash", "hate", "haul", "have",
    "head", "heal", "heap", "hear", "heat", "heed", "heel", "held", "helm", "help", "hens", "here",
    "hero", "hide", "high", "hill", "hind", "hint", "hire", "hoes", "hold", "hole", "holy", "home",
    "hone", "hood", "hoof", "hook", "hope", "horn", "hose", "host", "hour", "hung", "hunt", "hurt",
    "iced", "icon", "idea", "idle", "idol", "inch", "info", "inks", "into", "ions", "iris", "iron",
    "itch", "item", "jack", "jade", "java", "jest", "jets", "jobs", "john", "join", "jump", "junk",
    "jury", "just", "keen", "keep", "kern", "keys", "kick", "kids", "kill", "kind", "king", "kiss",
    "kite", "kits", "know", "labs", "lace", "lack", "lady", "laid", "lain", "lake", "lama", "lamp",
    "land", "lane", "laps", "lash", "lass", "last", "late", "lava", "laws", "lays", "lazy", "lead",
    "leaf", "lean", "leer", "lees", "left", "legs", "lend", "lens", "lent", "less", "lest", "lets",
    "libs", "lice", "lick", "lied", "lies", "life", "lift", "like", "lime", "line", "ling", "link",
    "lint", "lion", "list", "lite", "live", "load", "loan", "lock", "logo", "logs", "loin", "long",
    "look", "loom", "loon", "loop", "loot", "lord", "lose", "loss", "lost", "lots", "love", "luck",
    "lung", "lush", "lust", "mach", "made", "mage", "maid", "mail", "main", "make", "male", "mall",
    "mane", "mans", "many", "maps", "mare", "mark", "mars", "mart", "mask", "mass", "mast", "mate",
    "math", "maze", "meal", "mean", "meet", "meld", "memo", "mens", "menu", "mere", "merk", "mesa",
    "mesh", "mess", "meta", "mete", "mica", "mien", "mile", "milk", "mill", "mime", "mind", "mine",
    "mini", "mint", "miss", "mist", "mite", "mitt", "mock", "mode", "mods", "mono", "moon", "more",
    "mort", "most", "move", "much", "mung", "must", "mute", "name", "near", "neck", "need", "nest",
    "nets", "news", "next", "nice", "nick", "nine", "node", "norm", "nose", "note", "noun", "nova",
    "nuts", "odor", "offs", "okay", "olds", "omen", "omit", "once", "ones", "only", "onto", "open",
    "opts", "opus", "oral", "ores", "outs", "oval", "oven", "over", "owed", "owns", "pace", "pack",
    "pads", "page", "paid", "pain", "pair", "pane", "pang", "pant", "para", "pard", "pare", "park",
    "part", "pass", "past", "path", "pawn", "peak", "pear", "peas", "peat", "peek", "peer", "pend",
    "pens", "pent", "perk", "perm", "pert", "peso", "pets", "pick", "pics", "pier", "pies", "pile",
    "pill", "pine", "ping", "pink", "pins", "pipe", "plan", "plat", "play", "pled", "plot", "plug",
    "plus", "pods", "poke", "pole", "poll", "pond", "pone", "pong", "pony", "pool", "poor", "port",
    "pose", "post", "pots", "pour", "prim", "prod", "prof", "prom", "prop", "pros", "prow", "pull",
    "pump", "punt", "pure", "push", "puts", "quad", "quel", "quid", "quit", "quiz", "race", "rack",
    "raft", "rage", "raid", "rail", "rain", "rand", "rang", "rank", "rant", "rape", "rare", "rash",
    "rate", "rats", "read", "real", "rear", "redo", "reds", "reed", "reef", "refs", "rein", "rend",
    "rent", "repo", "rest", "rete", "rice", "rich", "ride", "riff", "ring", "rink", "riot", "rise",
    "risk", "rite", "road", "robe", "rock", "rode", "role", "roll", "roof", "rook", "room", "rope",
    "rose", "rota", "rote", "rows", "ruby", "rule", "rump", "runs", "rush", "rust", "safe", "sage",
    "said", "sale", "salt", "same", "sand", "sans", "sass", "save", "scan", "scar", "seal", "seat",
    "sect", "seed", "seek", "seen", "self", "sell", "semi", "send", "sent", "sept", "sera", "sets",
    "shaw", "shed", "shim", "shin", "ship", "shoe", "shop", "shot", "show", "side", "sign", "sing",
    "sink", "sins", "site", "size", "skat", "skim", "skin", "skip", "slag", "slam", "sled", "slot",
    "slow", "slug", "snap", "snow", "soap", "sock", "soft", "soil", "sold", "sole", "solo", "some",
    "song", "sons", "soon", "sort", "span", "spar", "spec", "sped", "spin", "spot", "spur", "stab",
    "stag", "star", "stat", "stay", "stem", "step", "stop", "stub", "stud", "subs", "such", "sure",
    "surf", "swap", "sync", "tabs", "tags", "tail", "take", "talk", "tank", "tare", "task", "team",
    "tear", "tech", "teen", "tees", "tell", "temp", "tent", "term", "tern", "text", "than", "that",
    "them", "then", "they", "thin", "this", "thus", "tick", "tier", "ties", "tile", "time", "ting",
    "tiny", "tips", "tone", "tong", "tons", "tool", "tops", "tors", "tour", "tout", "town", "trad",
    "tram", "trap", "tray", "tree", "trim", "trip", "tube", "turn", "twig", "type", "undo", "unit",
    "unto", "upon", "urge", "used", "user", "uses", "vain", "vair", "vale", "vang", "vare", "vars",
    "vary", "vast", "vector", "veil", "vela", "veld", "vena", "vend", "vent", "vera", "verb",
    "vert", "very", "vest", "vice", "vide", "vier", "view", "vill", "vina", "vine", "vino", "viol",
    "visa", "vise", "vita", "vive", "vole", "volt", "vote", "wait", "wake", "wale", "walk", "wall",
    "wand", "want", "ward", "ware", "warm", "warn", "warp", "wars", "wart", "wash", "wave", "ways",
    "weak", "wear", "weed", "week", "weer", "weet", "well", "welt", "went", "were", "wert", "west",
    "what", "when", "wick", "wide", "wife", "wild", "will", "wind", "wine", "wing", "wink", "wins",
    "wipe", "wire", "wise", "wish", "wiss", "wist", "with", "wolf", "wood", "word", "work", "worm",
    "wort", "wrap", "yang", "yard", "yeah", "year", "your", "zero", "zing", "zona", "zone", "zoom",
];

/// Generate a human-readable, URL-safe two-word identifier (`word1-word2`)
/// guaranteed to be at most 3 tokens in `o200k_base`.
pub fn generate_short_code() -> String {
    let len = WORDS.len();
    let idx1 = (rand::random::<u32>() as usize) % len;
    let idx2 = (rand::random::<u32>() as usize) % len;
    let code = format!("{}-{}", WORDS[idx1], WORDS[idx2]);
    debug_assert!(
        (2..=3).contains(&count_tokens(&code)),
        "short code {code:?} should be 2-3 tokens"
    );
    code
}

/// Generate a 2-token camelCase identifier (`word1Word2`) when an ultra-compact
/// delimiter-free token is desired.
pub fn generate_camel_short_code() -> String {
    let len = WORDS.len();
    let idx1 = (rand::random::<u32>() as usize) % len;
    let idx2 = (rand::random::<u32>() as usize) % len;
    let w1 = WORDS[idx1];
    let w2 = WORDS[idx2];
    let mut out = String::with_capacity(w1.len() + w2.len());
    out.push_str(w1);
    let mut chars = w2.chars();
    if let Some(first) = chars.next() {
        let _ = write!(out, "{}{}", first.to_ascii_uppercase(), chars.as_str());
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdRef {
    Uuid(Uuid),
    ShortCode(String),
}

impl IdRef {
    /// Parse either a standard UUID or a project-scoped short code
    /// (`word1-word2` or legacy 8-hex backfill).
    pub fn parse(input: &str) -> Result<Self, String> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return Err("identifier must not be empty".into());
        }
        if let Ok(uuid) = Uuid::parse_str(trimmed) {
            return Ok(Self::Uuid(uuid));
        }
        if is_valid_short_code(trimmed) {
            return Ok(Self::ShortCode(trimmed.to_ascii_lowercase()));
        }
        Err(format!(
            "invalid identifier {trimmed:?}: expected a UUID or short code (e.g. amber-anchor)"
        ))
    }
}

pub fn is_valid_short_code(value: &str) -> bool {
    if value.len() < 3 || value.len() > 32 {
        return false;
    }
    if let Some((a, b)) = value.split_once('-') {
        !a.is_empty()
            && !b.is_empty()
            && !b.contains('-')
            && a.bytes().all(|c| c.is_ascii_lowercase())
            && b.bytes().all(|c| c.is_ascii_lowercase())
    } else {
        // Support 8-char hex backfill codes for pre-migration rows.
        value.len() == 8 && value.bytes().all(|c| c.is_ascii_hexdigit())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_words_are_single_token_in_o200k_base() {
        assert_eq!(WORDS.len(), 945);
        for word in WORDS {
            assert_eq!(count_tokens(word), 1, "word {word:?} must be 1 token bare");
            assert_eq!(
                count_tokens(&format!(" {word}")),
                1,
                "word {word:?} must be 1 token with leading space"
            );
        }
    }

    #[test]
    fn generated_short_codes_are_strictly_2_or_3_tokens() {
        for _ in 0..200 {
            let code = generate_short_code();
            let tokens = count_tokens(&code);
            assert!(
                (2..=3).contains(&tokens),
                "expected 2-3 tokens for {code:?}, got {tokens}"
            );
            assert!(is_valid_short_code(&code));
        }
    }

    #[test]
    fn id_ref_parses_uuid_and_short_code() {
        let u = Uuid::new_v4();
        assert_eq!(IdRef::parse(&u.to_string()).unwrap(), IdRef::Uuid(u));
        assert_eq!(
            IdRef::parse("amber-anchor").unwrap(),
            IdRef::ShortCode("amber-anchor".into())
        );
        assert!(IdRef::parse("../bad").is_err());
        assert!(IdRef::parse("").is_err());
    }
}
