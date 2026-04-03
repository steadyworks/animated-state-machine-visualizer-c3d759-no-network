'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import gsap from 'gsap'

const RADIUS = 30
const ARROWHEAD_LEN = 8

type Mode = 'add-state' | 'add-transition' | 'move' | 'delete'
type Result = '' | 'Running' | 'Accepted' | 'Rejected' | 'No transition'

interface StateNode {
  name: string
  x: number
  y: number
  isAccepting: boolean
}

interface TransitionEdge {
  from: string
  to: string
  label: string
}

interface Machine {
  states: StateNode[]
  transitions: TransitionEdge[]
  startState: string | null
}

const STORAGE_KEY = 'dfa-machine-v1'
const EMPTY: Machine = { states: [], transitions: [], startState: null }

function loadMachine(): Machine {
  if (typeof window === 'undefined') return EMPTY
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (s) return JSON.parse(s)
  } catch {}
  return EMPTY
}

export default function Page() {
  const svgRef = useRef<SVGSVGElement>(null)
  const tokenRef = useRef<SVGGElement>(null)

  const [machine, setMachine] = useState<Machine>(EMPTY)
  const [mode, setMode] = useState<Mode>('add-state')
  const [editingPos, setEditingPos] = useState<{ x: number; y: number } | null>(null)
  const [pendingName, setPendingName] = useState('')
  const [transitionSrc, setTransitionSrc] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const dragOffset = useRef({ x: 0, y: 0 })
  const [error, setError] = useState('')
  const [testInput, setTestInput] = useState('')
  const [result, setResult] = useState<Result>('')
  const [currentStateDisplay, setCurrentStateDisplay] = useState('')
  const [showToken, setShowToken] = useState(false)
  const pendingNameRef = useRef('')
  const editingPosRef = useRef<{ x: number; y: number } | null>(null)

  // Eval state (refs to avoid stale closures in async fns)
  const evalRef = useRef({
    isRunning: false,
    stepIndex: 0,
    currentState: '',
    mode: 'idle' as 'idle' | 'stepping' | 'done',
  })

  // Load from localStorage once
  useEffect(() => {
    const m = loadMachine()
    setMachine(m)
  }, [])

  // Persist on every change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(machine))
  }, [machine])

  // Auto-dismiss error
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(''), 3000)
    return () => clearTimeout(t)
  }, [error])

  const getSVGPoint = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  // ── Add State ────────────────────────────────────────────────────────────────

  const handleBgClick = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== 'add-state') return
      const pt = getSVGPoint(e)
      setEditingPos(pt)
      editingPosRef.current = pt
      setPendingName('')
      pendingNameRef.current = ''
    },
    [mode, getSVGPoint]
  )

  const confirmAddState = useCallback(() => {
    const pos = editingPosRef.current
    const name = pendingNameRef.current.trim()
    setEditingPos(null)
    editingPosRef.current = null
    if (!pos || !name) return
    setMachine(m => {
      if (m.states.find(s => s.name === name)) {
        setError(`State "${name}" already exists`)
        return m
      }
      return { ...m, states: [...m.states, { name, x: pos.x, y: pos.y, isAccepting: false }] }
    })
  }, [])

  // ── State interactions ───────────────────────────────────────────────────────

  const handleStateClick = useCallback(
    (e: React.MouseEvent, name: string) => {
      e.stopPropagation()
      if (mode === 'delete') {
        setMachine(m => ({
          ...m,
          states: m.states.filter(s => s.name !== name),
          transitions: m.transitions.filter(t => t.from !== name && t.to !== name),
          startState: m.startState === name ? null : m.startState,
        }))
        return
      }
      if (mode === 'add-transition') {
        if (transitionSrc === null) {
          setTransitionSrc(name)
          return
        }
        const from = transitionSrc
        const to = name
        setTransitionSrc(null)
        const raw = window.prompt('Transition label (one character):')
        if (!raw) return
        const label = raw.trim()[0]
        if (!label) return
        setMachine(m => {
          if (m.transitions.find(t => t.from === from && t.label === label)) {
            setError(`DFA: "${from}" already has a "${label}" transition`)
            return m
          }
          return { ...m, transitions: [...m.transitions, { from, to, label }] }
        })
      }
    },
    [mode, transitionSrc]
  )

  const handleStateRightClick = useCallback((e: React.MouseEvent, name: string) => {
    e.preventDefault()
    e.stopPropagation()
    setMachine(m => ({ ...m, startState: name }))
  }, [])

  const handleStateDblClick = useCallback((e: React.MouseEvent, name: string) => {
    e.stopPropagation()
    setMachine(m => ({
      ...m,
      states: m.states.map(s => (s.name === name ? { ...s, isAccepting: !s.isAccepting } : s)),
    }))
  }, [])

  const handleStateMouseDown = useCallback(
    (e: React.MouseEvent, name: string) => {
      if (mode !== 'move') return
      e.stopPropagation()
      e.preventDefault()
      const pt = getSVGPoint(e)
      const s = machine.states.find(st => st.name === name)
      if (!s) return
      dragOffset.current = { x: pt.x - s.x, y: pt.y - s.y }
      setDragging(name)
    },
    [mode, getSVGPoint, machine.states]
  )

  const handleSVGMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return
      const pt = getSVGPoint(e)
      setMachine(m => ({
        ...m,
        states: m.states.map(s =>
          s.name === dragging
            ? { ...s, x: pt.x - dragOffset.current.x, y: pt.y - dragOffset.current.y }
            : s
        ),
      }))
    },
    [dragging, getSVGPoint]
  )

  const handleSVGMouseUp = useCallback(() => setDragging(null), [])

  const handleTransitionClick = useCallback(
    (e: React.MouseEvent, from: string, to: string, label: string) => {
      if (mode !== 'delete') return
      e.stopPropagation()
      setMachine(m => ({
        ...m,
        transitions: m.transitions.filter(
          t => !(t.from === from && t.to === to && t.label === label)
        ),
      }))
    },
    [mode]
  )

  const clearAll = useCallback(() => {
    setMachine(EMPTY)
    setResult('')
    setCurrentStateDisplay('')
    setShowToken(false)
    setTransitionSrc(null)
    setEditingPos(null)
    evalRef.current = { isRunning: false, stepIndex: 0, currentState: '', mode: 'idle' }
  }, [])

  // ── Arrow path computation ───────────────────────────────────────────────────

  function getParallel(t: TransitionEdge, transitions: TransitionEdge[]) {
    const group = transitions.filter(tr => tr.from === t.from && tr.to === t.to)
    return { index: group.findIndex(tr => tr.label === t.label), total: group.length }
  }

  function computeArrow(
    t: TransitionEdge,
    states: StateNode[],
    transitions: TransitionEdge[]
  ): { pathD: string; labelX: number; labelY: number } | null {
    const from = states.find(s => s.name === t.from)
    const to = states.find(s => s.name === t.to)
    if (!from || !to) return null

    if (t.from === t.to) {
      const cx = from.x
      const cy = from.y
      const pathD = `M ${cx - RADIUS * 0.5} ${cy - RADIUS} C ${cx - 65} ${cy - RADIUS * 3.2} ${cx + 65} ${cy - RADIUS * 3.2} ${cx + RADIUS * 0.5} ${cy - RADIUS}`
      return { pathD, labelX: cx, labelY: cy - RADIUS * 3.2 - 6 }
    }

    const dx = to.x - from.x
    const dy = to.y - from.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist === 0) return null
    const nx = dx / dist
    const ny = dy / dist
    const px = -ny
    const py = nx

    const x1 = from.x + nx * RADIUS
    const y1 = from.y + ny * RADIUS
    const x2 = to.x - nx * (RADIUS + ARROWHEAD_LEN)
    const y2 = to.y - ny * (RADIUS + ARROWHEAD_LEN)

    const { index, total } = getParallel(t, transitions)

    if (total <= 1) {
      return {
        pathD: `M ${x1} ${y1} L ${x2} ${y2}`,
        labelX: (x1 + x2) / 2 + px * 14,
        labelY: (y1 + y2) / 2 + py * 14,
      }
    }

    const curve = index === 0 ? 45 : -45
    const cpx = (x1 + x2) / 2 + px * curve
    const cpy = (y1 + y2) / 2 + py * curve
    return {
      pathD: `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`,
      labelX: cpx,
      labelY: cpy,
    }
  }

  // Start marker path
  function startMarkerPath(states: StateNode[], startState: string | null) {
    if (!startState) return null
    const s = states.find(st => st.name === startState)
    if (!s) return null
    return `M ${s.x - RADIUS - 45} ${s.y} L ${s.x - RADIUS - 6} ${s.y}`
  }

  // ── Token animation ──────────────────────────────────────────────────────────

  function placeToken(x: number, y: number) {
    if (!tokenRef.current) return
    gsap.set(tokenRef.current, { x, y })
  }

  function animateTokenTo(
    t: TransitionEdge,
    states: StateNode[]
  ): Promise<void> {
    return new Promise(resolve => {
      const from = states.find(s => s.name === t.from)
      const to = states.find(s => s.name === t.to)
      if (!tokenRef.current || !from || !to) {
        resolve()
        return
      }

      if (t.from === t.to) {
        // Self-loop arc animation
        const cx = from.x
        const cy = from.y
        gsap
          .timeline({ onComplete: resolve })
          .to(tokenRef.current, { x: cx - 50, y: cy - 70, duration: 0.22, ease: 'power2.out' })
          .to(tokenRef.current, { x: cx, y: cy - 95, duration: 0.18, ease: 'none' })
          .to(tokenRef.current, { x: cx + 50, y: cy - 70, duration: 0.18, ease: 'none' })
          .to(tokenRef.current, { x: cx, y: cy, duration: 0.22, ease: 'power2.in' })
      } else {
        gsap.to(tokenRef.current, {
          x: to.x,
          y: to.y,
          duration: 0.65,
          ease: 'power2.inOut',
          onComplete: resolve,
        })
      }
    })
  }

  function pulseState(name: string) {
    const el = document.querySelector(`[data-testid="state-${name}"]`)
    if (!el) return
    gsap.fromTo(
      el,
      { scale: 1 },
      { scale: 1.25, duration: 0.12, yoyo: true, repeat: 1, transformOrigin: '50% 50%' }
    )
  }

  // ── Evaluation ───────────────────────────────────────────────────────────────

  const machineRef = useRef(machine)
  machineRef.current = machine
  const testInputRef = useRef(testInput)
  testInputRef.current = testInput

  async function runEvaluation() {
    if (evalRef.current.isRunning) return
    const m = machineRef.current
    const input = testInputRef.current
    if (!m.startState) {
      setResult('No transition')
      return
    }

    evalRef.current.isRunning = true
    setResult('Running')
    setShowToken(true)

    const startObj = m.states.find(s => s.name === m.startState!)
    if (!startObj) {
      setResult('No transition')
      evalRef.current.isRunning = false
      return
    }

    placeToken(startObj.x, startObj.y)
    setCurrentStateDisplay(m.startState!)

    let current = m.startState!
    for (const ch of input) {
      const tr = m.transitions.find(t => t.from === current && t.label === ch)
      if (!tr) {
        setResult('No transition')
        evalRef.current.isRunning = false
        return
      }
      await animateTokenTo(tr, m.states)
      current = tr.to
      setCurrentStateDisplay(current)
      pulseState(current)
    }

    const finalState = m.states.find(s => s.name === current)
    setResult(finalState?.isAccepting ? 'Accepted' : 'Rejected')
    evalRef.current.isRunning = false
  }

  async function stepEvaluation() {
    if (evalRef.current.isRunning) return
    const m = machineRef.current
    const input = testInputRef.current
    const ev = evalRef.current

    if (ev.mode === 'done') return

    if (ev.mode === 'idle') {
      if (!m.startState) {
        setResult('No transition')
        return
      }
      const startObj = m.states.find(s => s.name === m.startState!)
      if (!startObj) {
        setResult('No transition')
        return
      }
      ev.currentState = m.startState!
      ev.stepIndex = 0
      ev.mode = 'stepping'
      setShowToken(true)
      placeToken(startObj.x, startObj.y)
      setCurrentStateDisplay(m.startState!)

      if (input.length === 0) {
        setResult(startObj.isAccepting ? 'Accepted' : 'Rejected')
        ev.mode = 'done'
        return
      }
    }

    if (ev.stepIndex >= input.length) {
      const finalState = m.states.find(s => s.name === ev.currentState)
      setResult(finalState?.isAccepting ? 'Accepted' : 'Rejected')
      ev.mode = 'done'
      return
    }

    const ch = input[ev.stepIndex]
    const tr = m.transitions.find(t => t.from === ev.currentState && t.label === ch)
    if (!tr) {
      setResult('No transition')
      ev.mode = 'done'
      return
    }

    ev.isRunning = true
    await animateTokenTo(tr, m.states)
    ev.isRunning = false

    ev.currentState = tr.to
    ev.stepIndex++
    setCurrentStateDisplay(ev.currentState)
    pulseState(ev.currentState)

    if (ev.stepIndex >= input.length) {
      const finalState = m.states.find(s => s.name === ev.currentState)
      setResult(finalState?.isAccepting ? 'Accepted' : 'Rejected')
      ev.mode = 'done'
    }
  }

  function resetEvaluation() {
    setResult('')
    setCurrentStateDisplay('')
    setShowToken(false)
    evalRef.current = { isRunning: false, stepIndex: 0, currentState: '', mode: 'idle' }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const markerPath = startMarkerPath(machine.states, machine.startState)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        fontFamily: 'sans-serif',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '8px 16px',
          background: '#f1f5f9',
          borderBottom: '1px solid #cbd5e1',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        {(
          [
            ['add-state', 'Add State'],
            ['add-transition', 'Add Transition'],
            ['move', 'Move'],
            ['delete', 'Delete'],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            data-testid={`mode-${m}`}
            onClick={() => {
              setMode(m)
              setTransitionSrc(null)
              setEditingPos(null)
            }}
            style={{
              padding: '6px 14px',
              cursor: 'pointer',
              background: mode === m ? '#3b82f6' : '#fff',
              color: mode === m ? '#fff' : '#334155',
              border: `1px solid ${mode === m ? '#2563eb' : '#cbd5e1'}`,
              borderRadius: 6,
              fontWeight: mode === m ? 700 : 400,
              fontSize: 13,
            }}
          >
            {label}
          </button>
        ))}
        <button
          data-testid="clear-all-btn"
          onClick={clearAll}
          style={{
            padding: '6px 14px',
            cursor: 'pointer',
            background: '#ef4444',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 13,
            marginLeft: 12,
          }}
        >
          Clear All
        </button>
        {error && (
          <span style={{ color: '#dc2626', fontSize: 13, marginLeft: 8 }}>{error}</span>
        )}
        {transitionSrc && (
          <span style={{ fontSize: 13, color: '#7c3aed', marginLeft: 8 }}>
            Click target state (from: {transitionSrc})
          </span>
        )}
      </div>

      {/* Main area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Canvas */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <svg
            ref={svgRef}
            data-testid="canvas"
            width="100%"
            height="100%"
            style={{
              display: 'block',
              background: '#fff',
              cursor: mode === 'add-state' ? 'crosshair' : mode === 'move' ? 'grab' : 'default',
            }}
            onMouseMove={handleSVGMouseMove}
            onMouseUp={handleSVGMouseUp}
          >
            <defs>
              <marker
                id="ah"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#475569" />
              </marker>
            </defs>

            {/* Transparent background rect to capture clicks */}
            <rect
              width="100%"
              height="100%"
              fill="transparent"
              onClick={handleBgClick}
            />

            {/* Transitions */}
            {machine.transitions.map(t => {
              const arrow = computeArrow(t, machine.states, machine.transitions)
              if (!arrow) return null
              const { pathD, labelX, labelY } = arrow
              const tid = `transition-${t.from}-${t.to}-${t.label}`
              return (
                <g
                  key={tid}
                  data-testid={tid}
                  onClick={e => handleTransitionClick(e, t.from, t.to, t.label)}
                  style={{ cursor: mode === 'delete' ? 'pointer' : 'default' }}
                >
                  <path
                    id={`arrow-path-${t.from}-${t.to}-${t.label}`}
                    d={pathD}
                    fill="none"
                    stroke="#475569"
                    strokeWidth={2}
                    markerEnd="url(#ah)"
                  />
                  {/* Wide invisible hit area */}
                  <path d={pathD} fill="none" stroke="transparent" strokeWidth={14} />
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={13}
                    fill="#1e293b"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {t.label}
                  </text>
                </g>
              )
            })}

            {/* Start marker */}
            {markerPath && (
              <g data-testid="start-marker">
                <path
                  d={markerPath}
                  stroke="#475569"
                  strokeWidth={2}
                  fill="none"
                  markerEnd="url(#ah)"
                />
              </g>
            )}

            {/* States */}
            {machine.states.map(state => (
              <g key={state.name}>
                <circle
                  data-testid={`state-${state.name}`}
                  cx={state.x}
                  cy={state.y}
                  r={RADIUS}
                  fill={transitionSrc === state.name ? '#bfdbfe' : '#dbeafe'}
                  stroke="#3b82f6"
                  strokeWidth={2}
                  style={{
                    cursor:
                      mode === 'delete' || mode === 'add-transition' || mode === 'move'
                        ? 'pointer'
                        : 'default',
                  }}
                  onClick={e => handleStateClick(e, state.name)}
                  onContextMenu={e => handleStateRightClick(e, state.name)}
                  onDoubleClick={e => handleStateDblClick(e, state.name)}
                  onMouseDown={e => handleStateMouseDown(e, state.name)}
                />
                {state.isAccepting && (
                  <circle
                    data-testid={`accepting-${state.name}`}
                    cx={state.x}
                    cy={state.y}
                    r={RADIUS - 6}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                <text
                  x={state.x}
                  y={state.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={13}
                  fill="#1e40af"
                  fontWeight={600}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {state.name}
                </text>
              </g>
            ))}

            {/* Token */}
            {showToken && (
              <g ref={tokenRef}>
                <circle
                  r={11}
                  fill="rgba(239,68,68,0.85)"
                  stroke="#b91c1c"
                  strokeWidth={2}
                />
              </g>
            )}
          </svg>

          {/* Inline name input overlay */}
          {editingPos && (
            <div
              style={{
                position: 'absolute',
                left: editingPos.x,
                top: editingPos.y,
                transform: 'translate(-50%, -50%)',
                zIndex: 20,
              }}
            >
              <input
                autoFocus
                value={pendingName}
                onChange={e => {
                  setPendingName(e.target.value)
                  pendingNameRef.current = e.target.value
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmAddState()
                  if (e.key === 'Escape') {
                    setEditingPos(null)
                    editingPosRef.current = null
                  }
                }}
                onBlur={confirmAddState}
                placeholder="Name"
                style={{
                  width: 64,
                  textAlign: 'center',
                  border: '2px solid #3b82f6',
                  borderRadius: 30,
                  padding: '5px 8px',
                  fontSize: 13,
                  outline: 'none',
                  background: '#eff6ff',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                }}
              />
            </div>
          )}
        </div>

        {/* Test panel */}
        <div
          data-testid="test-panel"
          style={{
            width: 220,
            padding: 16,
            background: '#f8fafc',
            borderLeft: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>Test Input</div>

          <input
            data-testid="test-input"
            value={testInput}
            onChange={e => setTestInput(e.target.value)}
            placeholder="Enter string…"
            style={{
              padding: '6px 8px',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              fontSize: 13,
              width: '100%',
              boxSizing: 'border-box',
            }}
          />

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              data-testid="run-btn"
              onClick={runEvaluation}
              style={{
                flex: 1,
                padding: '7px 0',
                background: '#22c55e',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              Run
            </button>
            <button
              data-testid="step-btn"
              onClick={stepEvaluation}
              style={{
                flex: 1,
                padding: '7px 0',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              Step
            </button>
          </div>

          <button
            data-testid="reset-btn"
            onClick={resetEvaluation}
            style={{
              padding: '7px 0',
              background: '#94a3b8',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Reset
          </button>

          <div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>Result:</div>
            <div
              data-testid="result-display"
              style={{
                padding: '7px 10px',
                background:
                  result === 'Accepted'
                    ? '#dcfce7'
                    : result === 'Rejected'
                    ? '#fee2e2'
                    : result === 'No transition'
                    ? '#fef9c3'
                    : result === 'Running'
                    ? '#dbeafe'
                    : '#f1f5f9',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                color:
                  result === 'Accepted'
                    ? '#16a34a'
                    : result === 'Rejected'
                    ? '#dc2626'
                    : result === 'No transition'
                    ? '#ca8a04'
                    : result === 'Running'
                    ? '#2563eb'
                    : '#94a3b8',
                minHeight: 34,
              }}
            >
              {result}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>Current state:</div>
            <div
              data-testid="current-state"
              style={{
                padding: '7px 10px',
                background: '#f1f5f9',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 700,
                color: '#0f172a',
                minHeight: 34,
              }}
            >
              {currentStateDisplay}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
