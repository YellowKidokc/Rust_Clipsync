# Argument Mapper: the questions to ask the API
*For Kimi to build the Obsidian `argument-mapper` plugin. October 28, 2026.*

## What this is for

Take one argument (a paper, a section, or a note) and turn it into a map: the separate claims, how each one supports or attacks another, what is left unsaid, and where it would break. The output uses the same claim format as the website (`claim-record/1`), so a mapped argument can go straight into the graph.

## Five rules for every call

1. **Quote, don't paraphrase.** Every item carries the exact sentence it came from and where (file, heading, paragraph).
2. **Stated and inferred never mix.** Anything the text does not say is marked `stated: false` with the reasoning. Hidden premises are always inferred.
3. **Grades are copied, never generated.** Warrant, outcome, match scope and canon status come from an existing node record, matched by meaning. With no match they stay empty. The model never decides that something is "proved".
4. **The model proposes; code computes.** The model finds claims and links. The plugin's own code works out the weakest link, circular reasoning and depth from the links, not the model.
5. **Bad output is rejected, not fixed.** Any answer that fails the schema goes to a reject list with the reason.

## How to run it (the cheap way)

Put the shared instructions and the vocabulary below **first**, then the whole argument text, then **one short question per call**. After a warm-up call, every later question reuses the cached prefix at the low rate. Ask the questions in order: each one's answer is passed into the next. Mark everything `source: AI-proposed (<model>, <date>)`.

---

## The questions

### Q1. What are the separate claims?
> List every distinct claim in the text, one assertion each. Split "A and B" into two. For each: an id (C1, C2, …), the claim in one plain sentence, and the exact quote with its location. Do not include claims the text does not make.

Output: `claims[] {local_id, text, quote, location}`

### Q2. What job does each claim do?
> For each claim, give its role in this argument: **conclusion** (what the argument is for), **intermediate** (a step that is concluded and then used), **premise** (used, never argued for here), **definition**, **assumption** (openly taken without support), **evidence** (an observation, data or experiment), **authority** (Scripture, a creed or a cited author), **example or illustration**, **objection** (raised against the argument), or **reply** (answers an objection). Quote the words that show the role ("therefore", "suppose", "it follows", …).

Output: `role` per claim, with `role_signal` (the quote)

### Q3. What supports what, and how?
> For every claim that is argued for, list the claims that bear on it. For each link give:
> - **direction:** supports, or attacks.
> - **attack type** (attacks only): *rebuts* (denies the conclusion), *undermines* (denies a premise), or *undercuts* (accepts the premises but denies that they lead there).
> - **kind of reasoning:** deductive (must follow), inductive (from cases), abductive (best explanation), analogical (by likeness), from authority, or definitional.
> - **together or alone:** do these premises support the claim only jointly (linked), or each on its own (convergent)?
> - the quote that shows the link.

Output: `links[] {from[], to, direction, attack_type, reasoning, joint, quote}`

### Q4. What is left unsaid?
> Where a step does not follow without an extra premise, write the missing premise as one sentence. Mark it `stated: false` and say why it is needed. Do not add premises the step does not need.

Output: `hidden_premises[] {text, needed_for, reasoning, stated: false}`

### Q5. How does each claim classify?
> For each claim choose exactly one value from each list. If none fits, answer `unclear` and say why; do not force it.
> - **claim_role:** axiom, definition, assumption, postulate, lemma, theorem, corollary, conjecture, identification, isomorphism, empirical_hypothesis
> - **system_part:** agent, state, boundary, operator, rule, initial_condition, symmetry, constitutive_law, conservation_law, observable
> - **register:** spiritual, formal, physical, embodied
> - **composition_level:** 0 atomic, 1 relational, 2 operational, 3 structural, 4 composite

Output: `tags` per claim (the same fields as claim-record/1)

### Q6. Is it already a node in the chain?
> For each claim, compare by **meaning**, not by name, against the supplied node statements. Answer one of: **matches** (give the node id and the node's line that matches), **new** (no node says this), or **conflicts** (it contradicts a node or a ruling; give which and why). Labels local to this text stay local: this text's "BC1" is not the chain's BC1 unless the text says so.

Output: `node_match {status, node_id, matching_line, reason}`. When status is matches, the grade is then **copied** from that node by code.

### Q7. How strongly does the text say it?
> For each claim, quote the words that set its strength ("proves", "shows", "suggests", "must", "may", "it is certain"). Rate the wording only: *demonstrative*, *confident*, *tentative*, or *none*.

Output: `stated_strength {level, quote}`. Code then flags **overclaim** when the wording is stronger than the copied grade (for example, "proves" on an unverified claim). The model never makes this call.

### Q8. What would break it?
> For each conclusion and intermediate step, what single finding or argument would show it false? Use the text's own words if it says; otherwise mark it inferred. Give the fastest test: an observation, a counterexample, or a proof.

Output: `breaks_if {text, stated, quote_or_reasoning}`

### Q9. What is the strongest objection?
> Give the strongest objection to the main conclusion as its best advocate would put it. If the text raises it, quote it and say whether the text answers it. If not, mark it AI-proposed.

Output: `objections[] {text, stated, answered_by, quote}`

### Q10. Which key words carry the weight, and do they shift?
> List the terms the argument depends on. For each, quote how the text defines or uses it. Flag any term used in two different senses (equivocation) and give both quotes.

Output: `terms[] {term, definition_quote, senses[], equivocation: true|false}`

### Q11. What does it cite?
> List every citation (Scripture, creeds, authors, data sets, experiments). For each: the reference exactly as given, the quote, and its use: **premise** (the argument needs it), **support** (it strengthens but isn't required), or **illustration**.

Output: `citations[] {ref, quote, use, supports_claim}`

### Q12. Where does it stop working?
> For each link that may not hold, name the obstruction type: **type mismatch**, **scale mismatch**, **empirical conflict**, **definitional conflict**, **missing bridge**, or **known countermodel**. Quote the place, and say whether it looks fatal, open, or already resolved in the text.

Output: `obstructions[] {link, kind, status, quote, reason}` (the same types as the chain's Q15/Q16)

### Q13 (optional). Which pattern of argument is this?
> Name the argument scheme if one clearly fits (for example: from cause to effect, from analogy, from expert opinion, from consequences, from sign, best explanation). Give the critical question that scheme must answer, and whether the text answers it.

Output: `scheme {name, critical_questions[], answered[]}`

---

## What the plugin's code works out (not the model)

From the links in Q3 and the hidden premises in Q4:
- **Circularity:** the conclusion appearing among its own supports, directly or through a chain.
- **Weakest link:** the premise whose failure takes down the most other claims. Count what stands downstream of it.
- **Depth:** the longest chain of supports below each claim (the same calculation as the website's graph).
- **Unsupported steps:** anything concluded with no incoming support link.
- **Overclaim:** the Q7 wording versus the copied grade.
- **Grades:** copied from matched nodes (Q6), never from the model.

## Categories for the plugin (note types and fields)

| Note type | Made from | Key fields |
|---|---|---|
| **Argument** | one per mapped text | source file, main conclusion, scheme, date mapped, model |
| **Claim** | Q1, Q2, Q5, Q7 | text, quote, role, tags, stated strength, node match, copied grade |
| **Link** | Q3 | from, to, supports or attacks, attack type, reasoning, joint |
| **Hidden premise** | Q4 | text, needed for, `stated: false`, reasoning |
| **Objection** | Q9 | text, stated, answered by |
| **Term** | Q10 | definition quote, senses, equivocation |
| **Citation** | Q11 | reference, use, supports which claim |
| **Obstruction** | Q12 | link, kind, fatal, open or resolved |

Use frontmatter for the fields and wikilinks for the links (`supports:: [[C3]]`), so Obsidian's graph shows the argument and Dataview can query it.

## Export to the website

Each Claim note exports as one `claim-record/1` file. The fields map like this:
- `series` and `paper` come from the Argument note.
- `claim_id` comes from the Argument and the local id.
- `source.quote` and `source.stated` come from Q1 and Q4.
- `tags` come from Q5.
- `grade` is copied from the Q6 node match. With no match, `warrant: unverified` and the rest stay empty.
- `neighbors` come from Q3: a support link becomes `rests_on`, an attack becomes `challenges`.

The site's build checks every record against the format, so anything malformed goes straight to the Rejected list.

## Test it before running the corpus

Map three texts first: **Grace Necessity (Paper I)**, **the Science Argument**, and **the Constraint-Class paper**. Compare the results by hand against GRACE-001's records and the chain's links. Check what Q6 matched correctly, what it missed, and what it invented. Fix the prompts before mapping anything else.
