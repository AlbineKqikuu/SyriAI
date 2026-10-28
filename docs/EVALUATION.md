# SyriAI Studio — evaluation

The evaluation has two parts:

- **A. Offline matcher evaluation** (reproducible, no people needed): does the new speech-to-script
  matcher follow a reader better than the original one?
- **B. User study** (to be run with participants): does voice tracking help presenters compared with
  a normal auto-scrolling teleprompter?

Suggested research questions:

- **RQ1:** How accurately does the matcher track the reading position under speech-recognition errors?
- **RQ2:** Compared with auto-scroll, does voice tracking reduce how often presenters lose their place,
  and does it change reading speed and eye contact?
- **RQ3:** How usable do presenters find the studio (SUS score)?

---

## A. Offline matcher evaluation

Run it with `npm run evaluate`. The results are written to `tools/results/`:
`matcher-evaluation.csv` / `.json`, and two ready-made figures, `fig-matcher-within2.svg` and
`fig-matcher-error.svg` (Albanian labels, white background, error bars = ±1 SD).

### Method

- **Corpus:** 3 Albanian news scripts (≈ 80 words each: politics, culture, weather), in
  `tools/evaluate-matcher.js`.
- **Simulated reader:** reads every word in order, in utterances of 5–12 words. After each word the
  recogniser emits an *interim* transcript containing the utterance so far, like Chrome does.
- **Noise model** (per word, seeded random numbers so runs are reproducible):

| Condition | Diacritics dropped | Letter substituted | Word missed | Filler inserted |
|---|---|---|---|---|
| clean | 0 % | 0 % | 0 % | 0 % |
| diacritics-only | 70 % | 0 % | 0 % | 0 % |
| light | 30 % | 5 % | 3 % | 2 % |
| moderate | 50 % | 12 % | 7 % | 5 % |
| heavy | 70 % | 20 % | 12 % | 8 % |

- **Matchers:** *legacy* (the original code, preserved unchanged in `tools/legacy-matcher.js`) and
  *new* (`js/shared/matcher.js`). Both receive exactly the same transcripts.
- **Runs:** 30 seeds × 3 scripts = 90 samples per condition and matcher.

### Metrics

After every recogniser update we compare the tracked word with the word actually being read:

- **Coverage:** share of the script the tracker reached by the end.
- **Mean absolute error:** average distance, in words, between the tracked and the true position.
- **Within ±2 words:** share of updates where the highlight was at most 2 words off. This is what
  the presenter perceives as "the prompter is with me".
- **Jump-ahead rate:** share of updates where the tracker was more than 3 words *ahead* of the reader.
  This is the most disruptive failure, because the text runs away.

### Results (30 runs, mean ± standard deviation)

| Condition | Matcher | Coverage % ↑ | Mean abs. error (words) ↓ | Within ±2 words % ↑ | Jump-ahead % ↓ |
|---|---|---|---|---|---|
| clean | legacy | 100.0 ± 0.0 | 0.28 ± 0.03 | 100.0 ± 0.0 | 0.00 ± 0.00 |
| clean | new | 100.0 ± 0.0 | 0.04 ± 0.02 | 100.0 ± 0.0 | 0.00 ± 0.00 |
| diacritics-only | legacy | 99.6 ± 0.9 | 0.72 ± 0.19 | 93.0 ± 4.5 | 0.00 ± 0.00 |
| diacritics-only | new | 100.0 ± 0.0 | 0.04 ± 0.02 | 100.0 ± 0.0 | 0.00 ± 0.00 |
| light | legacy | 99.7 ± 0.7 | 0.60 ± 0.34 | 96.0 ± 4.7 | 0.85 ± 3.64 |
| light | new | 100.0 ± 0.2 | 0.10 ± 0.05 | 99.8 ± 0.5 | 0.00 ± 0.00 |
| moderate | legacy | 99.5 ± 1.0 | 0.98 ± 0.42 | 89.1 ± 6.0 | 1.07 ± 4.18 |
| moderate | new | 99.9 ± 0.3 | 0.18 ± 0.06 | 99.5 ± 0.9 | 0.00 ± 0.00 |
| heavy | legacy | 98.6 ± 1.9 | 1.42 ± 0.54 | 80.7 ± 8.0 | 1.34 ± 4.29 |
| heavy | new | 99.8 ± 0.6 | 0.29 ± 0.11 | 98.7 ± 1.7 | 0.00 ± 0.00 |

**Interpretation:**

- Both matchers eventually reach the end of the script (coverage ≈ 100 %) because the simulated
  reader never stops. The difference is in how closely they follow along.
- With missing diacritics alone, the legacy matcher is within ±2 words in 93 % of updates. The new
  one stays at 100 %, because normalisation makes "eshte" and "është" identical.
- Under heavy noise, the share of updates within ±2 words rises from 80.7 % to 98.7 %, and the
  mean error falls about 5× (1.42 → 0.29 words).
- The legacy matcher occasionally jumps ahead (up to 1.3 % of updates, with high variance). It
  re-matches the same repeated interim sentence and lands on later repeats of common words. The
  new matcher did not jump ahead in any run.

**Limitations — state these in the thesis:**

- The noise is simulated. It contains exactly the error types the new matcher was designed for
  (missing diacritics, small misspellings, missed words, fillers), so these results show that the
  design works as intended. They are not a measurement of real-world accuracy.
- Real recognisers also make other errors: wrong word boundaries, homophones, numbers written as
  digits ("12" vs "dymbëdhjetë"). Real readers also skip, repeat or ad-lib. Part B covers this.
- The corpus is small. Extending it with real broadcast scripts is straightforward: add texts to
  `CORPUS`.

---

## B. User study protocol

### Design

- **Participants:** 8–12, e.g. journalism or media students (people who read aloud in public).
  Record only an anonymous ID (P01, P02, …).
- **Within-subjects**, two conditions:
  - **V** — voice tracking (SyriAI follows the voice; auto-scroll off)
  - **A** — auto-scroll at a fixed speed (a classic teleprompter; the participant chooses a
    comfortable speed during practice)
- **Counterbalancing:** half of the participants do V then A, half do A then V. Two scripts of
  similar length and difficulty (≈ 250 words each, same news style) are swapped between conditions
  the same way, so neither order nor script favours a condition.

| Participant | 1st run | 2nd run |
|---|---|---|
| P01, P05, P09 | V + Script 1 | A + Script 2 |
| P02, P06, P10 | A + Script 1 | V + Script 2 |
| P03, P07, P11 | V + Script 2 | A + Script 1 |
| P04, P08, P12 | A + Script 2 | V + Script 1 |

### Setup

- Use one laptop with Chrome, a webcam at eye level above the screen, a quiet room, and a stable
  internet connection.
- Store both scripts in the **script library** before the study.
- **Settings:** countdown 3 s; language Shqip (sq-AL). Keep the same font size for everyone.

### Procedure (≈ 20 minutes per participant)

1. Consent: explain that only metrics are saved; no audio or video is stored unless you press REC.
2. Practice (2 min) with a different short text in both modes. In condition A, let the participant
   choose the scroll speed and note it.
3. For each run:
   1. Open *Të dhënat e studimit*: enter the participant ID, choose the condition (**Njohje zëri** or
      **Lëvizje automatike**), and optionally add a note (e.g. "order VA, script 1").
   2. Open the script from the library, then press **Fillo LIVE**.
   3. The participant reads the whole script as if on air. The researcher tallies how often the
      participant **visibly loses their place** (pauses, searches, restarts a sentence).
   4. Press **Ndalo**. The session report appears and is saved automatically.
   5. In the report, under **Pas sesionit (studimi)**, enter your tally in *Herë që pjesëmarrësi
      humbi vendin* and click **Ruaj numrin**.
   6. Click **Pyetësori SUS** and let the participant answer the 10 statements. The score (0–100) is
      calculated and saved with the session.
4. At the end: which mode did they prefer, and why? (open question)

### Measures

| Measure | Source | Notes |
|---|---|---|
| Times lost place | researcher tally | primary outcome |
| Stalls (no progress > 4 s) | session report `stall_count` | automatic proxy for losing place (voice condition) |
| Duration, average words/minute | session report | |
| Progress % | session report | in auto-scroll mode estimated from scroll position |
| Looking at camera % | session report `eye_contact_pct` | heuristic; compare *between* conditions, not as an absolute |
| Voice match rate, processing time | session report | voice condition only; describes system behaviour |
| SUS usability score | built-in questionnaire (session report) | System Usability Scale, 10 items, 0–100; raw answers are exported too |
| Perceived workload | questionnaire (optional) | NASA-TLX raw, 6 items |
| Preference + comments | interview | qualitative |

The built-in SUS uses the author's Albanian translation of the ten standard items (Brooke, 1996).
Say this in the thesis, or replace the texts in `js/admin/session.js` (`SUS_ITEMS`) with a published
translation if one exists.

### Data export and analysis

1. Export all sessions: header icon **Historiku i sesioneve → Eksporto të gjitha (CSV)**, or open
   `/api/sessions/export.csv`.
2. Run the analysis:

   ```bash
   npm run analyze -- ~/Downloads/syriai-sessions-YYYYMMDD-HHMM.csv
   ```

   It pairs each participant's *voice* and *autoscroll* sessions (the latest session per condition
   is used), runs the tests below and writes `tools/results/study/`:
   - `study-results.md`: tables (median [IQR], mean ± SD, W, p, r) and draft result sentences
     in Albanian. Check and adapt them; they are not final text.
   - `study-paired.csv`: one row per participant, both conditions side by side.
   - `fig-*.svg`: a paired plot per measure, ready to insert in Word.
3. `npm run analyze -- --demo` runs the same pipeline on simulated data. Every output is marked
   **DEMO** so it cannot be mistaken for real results. Use it only to check the pipeline or to show
   your supervisor the planned analysis. Never report it as results.

The CSV works in Excel, SPSS, R or Python too.
- Samples this small are paired and often not normally distributed. Compare V and A with the
  **Wilcoxon signed-rank test**, and report median, interquartile range and the effect size
  r = Z / √N. A paired t-test is acceptable if the differences look normal (Shapiro–Wilk).
- Suggested figures: a paired dot plot of "times lost place" per participant (one line per person,
  V vs A); SUS boxplots per condition; one example of the reading-progress chart from the session
  report.

### Threats to validity

- **Learning effect:** reduced by counterbalancing and the practice run.
- **Script difficulty:** scripts are swapped between conditions (see the table above).
- **Speech service:** Chrome's recogniser may perform differently for different voices and
  accents. Report the match rate per participant.
- **Researcher tally:** if possible, have a second observer or a video recording (with consent) to
  check the counts.
- **Gaze metric:** heuristic and not calibrated. Use it only for within-person comparisons between
  conditions.
