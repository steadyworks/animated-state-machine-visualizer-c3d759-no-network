import { test, expect, type Page, type Dialog } from '@playwright/test'

// ─── Constants ───────────────────────────────────────────────────────────────

// Generous wait for GSAP animations to fully complete (e.g. token travel, pulse).
const ANIM_WAIT = 2_500

// Pre-defined canvas-relative positions (px from element top-left) for placing states.
// Spread well apart so circles never overlap each other.
const POS: Record<string, { x: number; y: number }> = {
  S0: { x: 150, y: 220 },
  S1: { x: 420, y: 220 },
  S2: { x: 690, y: 220 },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Switch to Add State mode, click the canvas at the state's position, fill the
 * inline name input, and confirm.  Waits for state-{name} to be visible.
 */
async function addState(page: Page, name: string) {
  const pos = POS[name] ?? { x: 150 + Object.keys(POS).indexOf(name) * 270, y: 220 }
  await page.getByTestId('mode-add-state').click()
  await page.getByTestId('canvas').click({ position: pos })

  // The inline input inside the new circle – exclude the persistent test-input field
  const input = page.locator('input:not([data-testid="test-input"]):visible').last()
  await input.waitFor({ state: 'visible', timeout: 5_000 })
  await input.fill(name)
  await input.press('Enter')

  await expect(page.getByTestId(`state-${name}`)).toBeVisible({ timeout: 5_000 })
}

/**
 * Switch to Add Transition mode, click source then target, and handle the label
 * prompt.  Supports both window.prompt() dialogs and inline inputs.
 * Waits for transition-{from}-{to}-{label} to be visible.
 */
async function addTransition(page: Page, from: string, to: string, label: string) {
  await page.getByTestId('mode-add-transition').click()

  let dialogHandled = false
  const onDialog = async (dialog: Dialog) => {
    dialogHandled = true
    // dialog.accept(promptText) sets the return value for window.prompt() and
    // clicks OK.  For alert/confirm dialogs the promptText argument is ignored.
    await dialog.accept(label)
  }
  page.once('dialog', onDialog)

  await page.getByTestId(`state-${from}`).click()
  await page.getByTestId(`state-${to}`).click()

  // Wait long enough for a dialog to fire (if the implementation uses one).
  await page.waitForTimeout(600)

  if (!dialogHandled) {
    // No dialog appeared — remove the orphaned listener and fall back to an
    // inline input inside the SVG canvas.
    page.off('dialog', onDialog)
    const input = page.locator('input:not([data-testid="test-input"]):visible').last()
    await input.waitFor({ state: 'visible', timeout: 3_000 })
    await input.fill(label)
    await input.press('Enter')
  }

  await page.waitForTimeout(300)
  await expect(page.getByTestId(`transition-${from}-${to}-${label}`)).toBeVisible({
    timeout: 5_000,
  })
}

/** Right-click a state to designate it as the start state. */
async function setStartState(page: Page, name: string) {
  await page.getByTestId(`state-${name}`).click({ button: 'right' })
  await expect(page.getByTestId('start-marker')).toBeVisible({ timeout: 5_000 })
}

/** Double-click a state to toggle it as an accepting state. */
async function setAccepting(page: Page, name: string) {
  await page.getByTestId(`state-${name}`).dblclick()
  await expect(page.getByTestId(`accepting-${name}`)).toBeVisible({ timeout: 5_000 })
}

// ─── Shared setup ─────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  // Navigate, clear any persisted localStorage from a previous test, then
  // reload so the app initialises with an empty machine.
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('canvas')).toBeVisible({ timeout: 10_000 })
})

// ─── TC-01: Place a single state ─────────────────────────────────────────────

test('TC-01: place a single state', async ({ page }) => {
  await page.getByTestId('clear-all-btn').click()
  await addState(page, 'S0')
  await expect(page.getByTestId('state-S0')).toBeVisible()
})

// ─── TC-02: Add a transition between two states ───────────────────────────────

test('TC-02: add a transition between two states', async ({ page }) => {
  await page.getByTestId('clear-all-btn').click()
  await addState(page, 'S0')
  await addState(page, 'S1')
  await addTransition(page, 'S0', 'S1', 'a')
  await expect(page.getByTestId('transition-S0-S1-a')).toBeVisible()
})

// ─── TC-03: Run — string accepted ────────────────────────────────────────────

test('TC-03: run — string accepted', async ({ page }) => {
  test.setTimeout(90_000)

  await page.getByTestId('clear-all-btn').click()
  await addState(page, 'S0')
  await addState(page, 'S1')
  await addTransition(page, 'S0', 'S1', 'a')
  await setStartState(page, 'S0')
  await setAccepting(page, 'S1')

  await page.getByTestId('test-input').fill('a')
  await page.getByTestId('run-btn').click()
  await page.waitForTimeout(ANIM_WAIT)

  await expect(page.getByTestId('result-display')).toHaveText('Accepted', { timeout: 15_000 })
})

// ─── TC-04: Run — no transition (missing symbol) ──────────────────────────────

test('TC-04: run — no transition (missing symbol)', async ({ page }) => {
  test.setTimeout(90_000)

  await page.getByTestId('clear-all-btn').click()
  await addState(page, 'S0')
  await addState(page, 'S1')
  await addTransition(page, 'S0', 'S1', 'a')
  await setStartState(page, 'S0')
  await setAccepting(page, 'S1')

  await page.getByTestId('test-input').fill('b')
  await page.getByTestId('run-btn').click()
  await page.waitForTimeout(ANIM_WAIT)

  await expect(page.getByTestId('result-display')).toHaveText('No transition', { timeout: 15_000 })
})

// ─── TC-05: Three-state chain ─────────────────────────────────────────────────

test('TC-05: three-state chain — accepted, rejected, no-transition', async ({ page }) => {
  test.setTimeout(120_000)

  await page.getByTestId('clear-all-btn').click()
  await addState(page, 'S0')
  await addState(page, 'S1')
  await addState(page, 'S2')
  await addTransition(page, 'S0', 'S1', 'a')
  await addTransition(page, 'S1', 'S2', 'b')
  await setStartState(page, 'S0')
  await setAccepting(page, 'S2')

  // Part A: "ab" → Accepted (traverses S0 → S1 → S2)
  await page.getByTestId('test-input').fill('ab')
  await page.getByTestId('run-btn').click()
  await page.waitForTimeout(ANIM_WAIT)
  await expect(page.getByTestId('result-display')).toHaveText('Accepted', { timeout: 15_000 })

  // Part B: "a" → Rejected (ends on S1, which is not accepting)
  await page.getByTestId('reset-btn').click()
  await page.getByTestId('test-input').fill('a')
  await page.getByTestId('run-btn').click()
  await page.waitForTimeout(ANIM_WAIT)
  await expect(page.getByTestId('result-display')).toHaveText('Rejected', { timeout: 15_000 })

  // Part C: "ba" → No transition (S0 has no 'b' outgoing transition)
  await page.getByTestId('reset-btn').click()
  await page.getByTestId('test-input').fill('ba')
  await page.getByTestId('run-btn').click()
  await page.waitForTimeout(ANIM_WAIT)
  await expect(page.getByTestId('result-display')).toHaveText('No transition', { timeout: 15_000 })
})

// ─── TC-06: Self-loop renders and works ───────────────────────────────────────

test('TC-06: self-loop renders as a visible arc and machine accepts "bbba"', async ({ page }) => {
  test.setTimeout(90_000)

  await page.getByTestId('clear-all-btn').click()
  await addState(page, 'S0')
  await addState(page, 'S1')
  await addTransition(page, 'S0', 'S0', 'b') // self-loop
  await addTransition(page, 'S0', 'S1', 'a')
  await setStartState(page, 'S0')
  await setAccepting(page, 'S1')

  // Self-loop must have a non-trivial bounding box (an arc, not a zero-length line)
  const selfLoop = page.getByTestId('transition-S0-S0-b')
  await expect(selfLoop).toBeVisible({ timeout: 5_000 })
  const bbox = await selfLoop.boundingBox()
  expect(bbox).not.toBeNull()
  expect(bbox!.width).toBeGreaterThan(5)
  expect(bbox!.height).toBeGreaterThan(5)

  // "bbba" → Accepted (three self-loops then exit to S1)
  await page.getByTestId('test-input').fill('bbba')
  await page.getByTestId('run-btn').click()
  await page.waitForTimeout(ANIM_WAIT)
  await expect(page.getByTestId('result-display')).toHaveText('Accepted', { timeout: 15_000 })
})

// ─── TC-07: DFA constraint — duplicate transition rejected ───────────────────

test('TC-07: DFA constraint — duplicate transition from same source+label rejected', async ({ page }) => {
  test.setTimeout(60_000)

  await page.getByTestId('clear-all-btn').click()
  await addState(page, 'S0')
  await addState(page, 'S1')
  await addState(page, 'S2')
  await addTransition(page, 'S0', 'S1', 'a') // valid first transition

  // Attempt duplicate: S0 -a-> S2 conflicts with existing S0 -a-> S1
  await page.getByTestId('mode-add-transition').click()

  let dialogHandled = false
  const onDialog = async (dialog: Dialog) => {
    dialogHandled = true
    await dialog.accept('a')
  }
  page.once('dialog', onDialog)

  await page.getByTestId('state-S0').click()
  await page.getByTestId('state-S2').click()
  await page.waitForTimeout(600)

  if (!dialogHandled) {
    page.off('dialog', onDialog)
    const input = page.locator('input:not([data-testid="test-input"]):visible').last()
    const count = await input.count()
    if (count > 0) {
      await input.fill('a')
      await input.press('Enter')
    }
  }

  // Give the app time to validate and show any error UI
  await page.waitForTimeout(500)

  // Primary assertion: the duplicate transition must NOT have been created
  await expect(page.getByTestId('transition-S0-S2-a')).not.toBeVisible({ timeout: 3_000 })

  // The original valid transition must still be present
  await expect(page.getByTestId('transition-S0-S1-a')).toBeVisible()
})

// ─── TC-08: Move mode updates connected arrows ────────────────────────────────

test('TC-08: move mode — dragging a state repositions its connected arrows', async ({ page }) => {
  test.setTimeout(90_000)

  await page.getByTestId('clear-all-btn').click()
  await addState(page, 'S0')
  await addState(page, 'S1')
  await addTransition(page, 'S0', 'S1', 'a')

  const transition = page.getByTestId('transition-S0-S1-a')
  await expect(transition).toBeVisible({ timeout: 5_000 })
  const beforeBBox = await transition.boundingBox()
  expect(beforeBBox).not.toBeNull()

  await page.getByTestId('mode-move').click()

  const s1 = page.getByTestId('state-S1')
  const s1Box = await s1.boundingBox()
  expect(s1Box).not.toBeNull()

  // Drag S1 at least 150 px to clearly change the arrow geometry
  const cx = s1Box!.x + s1Box!.width / 2
  const cy = s1Box!.y + s1Box!.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 150, cy + 100, { steps: 10 })
  await page.mouse.up()

  await page.waitForTimeout(ANIM_WAIT)

  // Arrow must still exist and must have moved
  await expect(transition).toBeVisible()
  const afterBBox = await transition.boundingBox()
  expect(afterBBox).not.toBeNull()

  const hasGeometryChanged =
    Math.abs(afterBBox!.x - beforeBBox!.x) > 20 ||
    Math.abs(afterBBox!.y - beforeBBox!.y) > 20 ||
    Math.abs(afterBBox!.width - beforeBBox!.width) > 20 ||
    Math.abs(afterBBox!.height - beforeBBox!.height) > 20
  expect(hasGeometryChanged).toBe(true)
})

// ─── TC-09: localStorage persistence across reload ────────────────────────────

test('TC-09: localStorage persistence — machine fully restored after reload', async ({ page }) => {
  test.setTimeout(90_000)

  await page.getByTestId('clear-all-btn').click()
  await addState(page, 'S0')
  await addState(page, 'S1')
  await addState(page, 'S2')
  await addTransition(page, 'S0', 'S1', 'a')
  await addTransition(page, 'S1', 'S2', 'b')
  await setStartState(page, 'S0')
  await setAccepting(page, 'S2')

  // Allow all writes to settle before reloading (the app writes on every change)
  await page.waitForTimeout(500)

  // Reload without clearing localStorage
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('canvas')).toBeVisible({ timeout: 10_000 })
  // Allow time for the restore animation to finish
  await page.waitForTimeout(1_500)

  await expect(page.getByTestId('state-S0')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('state-S1')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('state-S2')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('transition-S0-S1-a')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('transition-S1-S2-b')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('start-marker')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('accepting-S2')).toBeVisible({ timeout: 5_000 })
})

// ─── TC-10: Step mode — one symbol at a time ─────────────────────────────────

test('TC-10: step mode — processes exactly one symbol per click', async ({ page }) => {
  test.setTimeout(90_000)

  await page.getByTestId('clear-all-btn').click()
  await addState(page, 'S0')
  await addState(page, 'S1')
  await addState(page, 'S2')
  await addTransition(page, 'S0', 'S1', 'a')
  await addTransition(page, 'S1', 'S2', 'b')
  await setStartState(page, 'S0')
  await setAccepting(page, 'S2')

  await page.getByTestId('test-input').fill('ab')

  // — Step 1: consume 'a', land on S1 ——————————————————————————————————————
  await page.getByTestId('step-btn').click()
  await page.waitForTimeout(ANIM_WAIT)

  await expect(page.getByTestId('current-state')).toHaveText('S1', { timeout: 10_000 })

  // No final verdict should be visible yet (still more input to process)
  const midResult = (await page.getByTestId('result-display').textContent()) ?? ''
  const FINAL_RESULTS = ['Accepted', 'Rejected', 'No transition']
  expect(FINAL_RESULTS).not.toContain(midResult.trim())

  // — Step 2: consume 'b', land on S2 (accepting) ——————————————————————————
  await page.getByTestId('step-btn').click()
  await page.waitForTimeout(ANIM_WAIT)

  await expect(page.getByTestId('current-state')).toHaveText('S2', { timeout: 10_000 })
  await expect(page.getByTestId('result-display')).toHaveText('Accepted', { timeout: 10_000 })
})

// ─── TC-11: Delete mode removes state and transitions ─────────────────────────

test('TC-11: delete mode — removes state and all connected transitions', async ({ page }) => {
  test.setTimeout(90_000)

  await page.getByTestId('clear-all-btn').click()
  await addState(page, 'S0')
  await addState(page, 'S1')
  await addState(page, 'S2')
  await addTransition(page, 'S0', 'S1', 'a')
  await addTransition(page, 'S1', 'S2', 'b')
  await setStartState(page, 'S0')
  await setAccepting(page, 'S2')

  // Delete S1 — must cascade to both transitions that involve it
  await page.getByTestId('mode-delete').click()
  await page.getByTestId('state-S1').click()
  await page.waitForTimeout(500)

  await expect(page.getByTestId('state-S1')).not.toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('transition-S0-S1-a')).not.toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('transition-S1-S2-b')).not.toBeVisible({ timeout: 5_000 })

  // S0 now has no outgoing transition → "No transition" on any input
  await page.getByTestId('test-input').fill('ab')
  await page.getByTestId('run-btn').click()
  await page.waitForTimeout(ANIM_WAIT)
  await expect(page.getByTestId('result-display')).toHaveText('No transition', { timeout: 15_000 })
})

// ─── TC-12: Parallel transitions (same src+dst, different labels) curve apart ──
//
// The spec requires: "when two transitions connect the same pair of states in
// the same direction (with different labels), each arrow must curve away from
// the straight-line path in opposite directions so neither obscures the other."
// Using S0→S1 (a) and S0→S1 (b) exercises that rule directly.

test('TC-12: parallel transitions (same source+target) render as distinct curved arrows', async ({ page }) => {
  test.setTimeout(60_000)

  await page.getByTestId('clear-all-btn').click()
  await addState(page, 'S0')
  await addState(page, 'S1')
  await addTransition(page, 'S0', 'S1', 'a')
  await addTransition(page, 'S0', 'S1', 'b')

  const t1 = page.getByTestId('transition-S0-S1-a')
  const t2 = page.getByTestId('transition-S0-S1-b')

  await expect(t1).toBeVisible({ timeout: 5_000 })
  await expect(t2).toBeVisible({ timeout: 5_000 })

  const bbox1 = await t1.boundingBox()
  const bbox2 = await t2.boundingBox()
  expect(bbox1).not.toBeNull()
  expect(bbox2).not.toBeNull()

  // Both arrows must have non-trivial size (not collapsed to a zero-length line)
  expect(bbox1!.width + bbox1!.height).toBeGreaterThan(10)
  expect(bbox2!.width + bbox2!.height).toBeGreaterThan(10)

  // The two parallel arrows must occupy geometrically distinct positions —
  // curving in opposite directions means their bounding boxes differ in x, y,
  // or height by more than a few pixels.
  const isDistinct =
    Math.abs(bbox1!.x - bbox2!.x) > 5 ||
    Math.abs(bbox1!.y - bbox2!.y) > 5 ||
    Math.abs(bbox1!.height - bbox2!.height) > 5
  expect(isDistinct).toBe(true)
})
