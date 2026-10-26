# Faith thru Physics

A research framework that tests Christian theology the way a scientist tests a theory. Every claim carries an honest label saying how we know it, and this site exists to keep that label visible without getting in the way of reading.

The site is open: everything renders from JSON files in `data/`, so anyone can add a series, a paper, or their own axioms and see what kind of town they make.

## The rules the site keeps

- **Never show a claim stronger than its grade.** A claim that is proved only if a premise holds always shows its "if".
- **Failures stay visible.** A record that fails the format is listed on `/rejected` with its reasons and shown nowhere else. Nothing repairs it.
- **Scores are labeled AI-proposed** wherever they appear.
- **Prose and tables never mix.** Tables live in a paper's Ledger tab.
- **The Town shows the structure of the rules; it doesn't prove them.**

## Run it

```
npm install
npm run dev        # builds the data, then serves at http://localhost:5173
npm test           # record validation and the simulation
npm run build      # static site in dist/, for Cloudflare Pages
```

### Cloudflare Pages

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `faith-thru-physics` (while it lives inside this repository)

`public/_redirects` sends every path to the app, so `/papers/grace-necessity-paper-1/` and `/claims/C8.1/` are real, shareable addresses. Anything live (search, the conversation) is a placeholder in `src/lib/worker.js` that will call a Cloudflare Worker at `/api/…`. No API key lives in the site.

`npm run build:preview` makes a copy with relative paths and `#/` addresses, for hosts that have no fallback route.

## Where things live

```
data/
  series/<series>/series.json          title and summary of a series
  series/<series>/claims/<id>.json     ONE claim record per file (format below)
  series/<series>/papers/<paper>.json  a paper: prose with claim markers
  sources/                             original files records were converted from
  towns/*.json                         towns for the Town page
scripts/build-data.mjs                 validates everything, writes public/data/ (generated, not committed)
scripts/import-node-contracts.mjs      converts a node_contracts.json into claim records
```

`npm run data` writes `public/data/claims/<id>.json` (one per valid claim), small index files (`index/claims.json`, `index/papers.json`, `index/series.json`, `index/towns.json`), and `rejects.json`. The browser loads only the index plus the records a page needs.

To add a series: make `data/series/<name>/series.json` and put one claim file per claim in `claims/`. Run `npm run data` and read the output: every rejected record is printed with its reasons.

## The claim record (claim-record/1)

One self-contained record per claim. It says which series, which paper and which claim it is.

```json
{
  "record_version": "claim-record/1",
  "series": "grace",
  "paper": "grace-necessity-paper-1",
  "claim_id": "C8.1",
  "type": "CLAIM",
  "text": "No person can flip their own sign.",
  "source": { "file": "papers/grace-necessity.md", "quote": "no person can flip their own sign", "stated": true },
  "tags": { "system_part": "operator", "composition_level": 2, "claim_role": "theorem", "register": "spiritual" },
  "grade": {
    "match_scope": "states_and_moves",
    "warrant": "conditionally_proved",
    "warrant_premise": "P-SIGN: the operations available to a fallen will preserve its orientation",
    "outcome": "holds",
    "canon_status": "open",
    "grade_source": "copied:OUTBOX/CHAIN_RERUN_2026-10-25/nodes/C8.1.yaml"
  },
  "receipts": [{ "kind": "lean", "ref": "Wall.lean: works_cannot_flip", "verification": "machine_verified" }],
  "neighbors": [{ "id": "W1", "edge": "rests_on" }, { "id": "GA", "edge": "holds_up" }],
  "generated_by": "AI-proposed (DeepSeek, 2026-10-25)"
}
```

**Required** (missing any one rejects the record): `record_version`, `series`, `paper`, `claim_id`, `type`, `text`, `source.quote`, `source.stated`, `grade.warrant`, `grade.canon_status`, `grade.grade_source`.

| Field | Allowed values |
|---|---|
| `type` | CLAIM, PREMISE, DEFINITION, LEAN, PROOF, EVIDENCE, AUDIT, RECEIPT |
| `tags.system_part` | agent, state, boundary, operator, rule, initial_condition, symmetry, constitutive_law, conservation_law, observable |
| `tags.composition_level` | 0 atomic, 1 relational, 2 operational, 3 structural, 4 composite |
| `tags.claim_role` | axiom, definition, assumption, postulate, lemma, theorem, corollary, conjecture, identification, isomorphism, empirical_hypothesis |
| `tags.register` | spiritual, formal, physical, embodied |
| `grade.match_scope` | states_only, states_and_moves, not_applicable |
| `grade.warrant` | proved, conditionally_proved, admitted, unverified, disputed |
| `grade.outcome` | holds, fails, null |
| `grade.canon_status` | canon, open, retired |
| `receipts[].verification` | machine_verified, peer_reviewed, author_verified, unverified |
| `neighbors[].edge` | rests_on, holds_up, formalizes, sharpens, sources, challenges, instantiates, verifies, bridges_to, conflicts_with |
| `source.stated` | true, or false with `source.reasoning` |

Three rules: grades are copied, never generated (`grade_source` names where from); `warrant_premise` is required whenever `warrant` is `conditionally_proved`; a record that fails goes to the reject list with its reasons.

Optional fields the site uses: `breaks_if` (the claim page's "What would break it"). The build fills in `holds_up` for every `rests_on` edge and `appears_in` (where the claim appears in a paper).

### The graph's lenses (provisional)

| Lens | Shows |
|---|---|
| Axioms | claim_role axiom, postulate, assumption, definition |
| Arguments | lemma, theorem, corollary, conjecture |
| Doctrines | register spiritual |
| Laws | system_part rule, conservation_law, constitutive_law |
| Bridges | identification, isomorphism, or any bridges_to edge |

Depth (down the page) is the longest chain of `rests_on` edges to a claim with none. Columns are the system part.

## A paper (paper/1)

```json
{
  "series": "grace", "paper": "grace-necessity-paper-1", "title": "Grace Necessity", "subtitle": "Paper I",
  "ten_second": { "ground": "…", "question": "…", "claim": "C8.1", "break_it": "…" },
  "sections": [
    { "heading": "The question", "level": 1,
      "paragraphs": [["Plain text, then ", { "claim": "C8.1", "text": "No person can flip their own sign" }, ", more text."]] }
  ]
}
```

A paragraph is a list of plain strings and claim markers. `level` 1–3 sets how technical a section reads. The marker's color and the card come from the claim record, never from the paper. A marker whose claim has no valid record shows a `?`.

## The Town

Two kinds of town file. Both load as one JSON file, as CSV files named after their sheets (`rules.csv`, `nodes.csv` …), or as one Excel workbook with sheets of those names. Rows that fail are listed as rejected, not loaded.

### Agents in the town (town-agents/1)

Agents move between nodes by rules. The sample is `data/towns/grace-agents.json`; its rival is `grace-rival.json`.

| Sheet | Columns |
|---|---|
| **nodes** | `id`, `label`, `shape` (place = circle, boundary = square, operator = hexagon), `x`, `y` (on a 1000 × 600 map), `sub`, `front`, `back` (plain words for the front and back doors) |
| **kinds** | `kind`, `label`, `count`, `max`, `start_node`, `start_state`, `color` (blank = colored by state), `behaves` (yes = follows the behavior setting), `report` (yes = the kind the report counts), `each` (name for one: Person), `name` (for a single agent: The Spirit), `var.<name>` (starting values) |
| **states** | `kind`, `state`, `label`, `color` |
| **rules** | see below |
| **report** | `label`, `measure`, `why_zero` |
| **params** | `id`, `label`, `min`, `max`, `step`, `value` (sliders; usable in expressions) |

**Rules**: `id`, `label`, `actor` (the kind who acts), `target` (the kind acted on; blank = the actor itself), `from` (the target must be at this node), `to` (it moves here), `when` (condition), `then` (changes), `chance` (probability it comes up), `blocks` (rule ids the target cannot use this step), `actor_to` (`target` = the actor goes where the target is), `always` (fire even when nothing changes), `say` (the log line, with `{a}`, `{t}`, `{choice}`), `door`, `handle` (inside / outside), `warrant`, `receipt`.

**A choice**: `choice` = `accept|refuse`, with `then_accept`, `then_refuse`, `to_accept`, `to_refuse`, and `lean` (an expression for how often the first answer is chosen, such as the param `accept`). The person answers from their own acceptance rate, or you answer as them if you tick "Let me answer". The engine never picks for them.

In expressions, `a.` is the actor and `t.` the target: `t.state == 'away' and t.debt > 0`. Each step, every agent acts at most once, in the order of the kinds sheet. Every random draw comes from one seeded generator, so a fixed seed repeats exactly.

**Report measures**: `end:state=grow` (share of the report kind in that state at the end), `avg_steps:state=grow` (average step on first reaching it), `count:R=accept` or `count:HES` (how often a rule fired). A row naming a rule the town does not have reads `0` with `why_zero`, so comparing two rule sets shows what each rule makes possible.

### Rule towns (town-rules/1)

Things change state one rule at a time (`data/towns/grace-rules.json`, `zfc-rules.json`).

| Sheet | Columns |
|---|---|
| **things** | `id`, `kind`, `label`, then any columns, which become the thing's values (`members` for a set) |
| **states** | `kind`, `state`, `when` (about `x`), `color`, `room` |
| **rules** | `id`, `label`, `agent` (blank = no one), `on` (`p:person` or `x:set, y:set`), `when`, `then`, or `choice` with `then_<answer>`; `create` (`set: members = pair(x, y)`); `auto` (no = only when pressed); `handle`, `door`, `boundary`, `warrant`, `receipt` |
| **agents** | `id`, `label`, `kind` |

### Expressions (both kinds)

Numbers, `'text'`, `true`/`false`, `and or not`, `== != < > <= >=`, `+ - * /`, and the functions `min max abs round size rank pair union power member`. No other code runs.

## Optional AI

The Town's "Ask an AI" uses the visitor's own Anthropic key. It is stored in their browser only and sent straight to Anthropic, never to this site. The AI can explain or suggest; it cannot apply a rule or answer anyone's choice.

## What is sample data

- The paper's sentences are placeholders around real claim records.
- `C8.1` is copied from the claim-record contract's example. `B-GRAV` and `AX-GOD` are design fixtures, and their `grade_source` says so.
- The 55 GRACE-001 records are converted from `node_contracts.json` with grades copied. `canon_status` is not in that file, so it is written `open`, and each record's `grade_source` says so. Nine conditionally proved claims name no premise, so they are rejected.
- In the agent town, walking between the World and the Wall, the adversary's pressure and every starting number are modeling choices, and those rules say so in their `warrant`.
