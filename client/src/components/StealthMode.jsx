import { useEffect, useRef, useState } from 'react';
import { getStealthPin, hashStealthPin } from '../utils/stealth.js';

const NOTES_KEY = 'silent_sos_decoy_notes';
const EXIT_HOLD_MS = 1800;

const CALCULATOR_ROWS = [
  [
    { label: 'AC', kind: 'clear', className: 'fn' },
    { label: '±', kind: 'sign', className: 'fn' },
    { label: '%', kind: 'percent', className: 'fn' },
    { label: '÷', kind: 'operator', className: 'op' },
  ],
  [
    { label: '7', kind: 'digit' },
    { label: '8', kind: 'digit' },
    { label: '9', kind: 'digit' },
    { label: '×', kind: 'operator', className: 'op' },
  ],
  [
    { label: '4', kind: 'digit' },
    { label: '5', kind: 'digit' },
    { label: '6', kind: 'digit' },
    { label: '−', kind: 'operator', className: 'op' },
  ],
  [
    { label: '1', kind: 'digit' },
    { label: '2', kind: 'digit' },
    { label: '3', kind: 'digit' },
    { label: '+', kind: 'operator', className: 'op' },
  ],
  [
    { label: '0', kind: 'digit', className: 'zero' },
    { label: '.', kind: 'dot' },
    { label: '=', kind: 'equals', className: 'equals' },
  ],
];

function compute(left, right, operator) {
  switch (operator) {
    case '+':
      return left + right;
    case '−':
      return left - right;
    case '×':
      return left * right;
    case '÷':
      return right === 0 ? Number.NaN : left / right;
    default:
      return right;
  }
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return 'Error';
  const normalized = Math.abs(value) < 1e-12 ? 0 : Number.parseFloat(value.toFixed(10));
  const text = String(normalized);
  if (text.length <= 12) return text;
  return normalized.toExponential(6);
}

export default function StealthMode({ onPanic, onExit }) {
  const [tab, setTab] = useState('calculator');
  const [display, setDisplay] = useState('0');
  const [stored, setStored] = useState(null);
  const [operator, setOperator] = useState(null);
  const [replaceDisplay, setReplaceDisplay] = useState(true);
  const [equation, setEquation] = useState('');
  const [notes, setNotes] = useState(() => {
    try {
      return localStorage.getItem(NOTES_KEY) || '';
    } catch {
      return '';
    }
  });
  const exitTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(exitTimerRef.current), []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        onExit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExit]);

  const resetCalculator = () => {
    setDisplay('0');
    setStored(null);
    setOperator(null);
    setReplaceDisplay(true);
    setEquation('');
  };

  const inputDigit = (digit) => {
    if (replaceDisplay) {
      setDisplay(digit);
      setReplaceDisplay(false);
      return;
    }
    setDisplay((prev) => {
      if (prev.replace('.', '').length >= 12) return prev;
      return prev === '0' ? digit : prev + digit;
    });
  };

  const inputDot = () => {
    if (replaceDisplay) {
      setDisplay('0.');
      setReplaceDisplay(false);
      return;
    }
    setDisplay((prev) => (prev.includes('.') ? prev : `${prev}.`));
  };

  const chooseOperator = (nextOperator) => {
    const current = Number.parseFloat(display) || 0;
    setStored(current);
    setOperator(nextOperator);
    setEquation(`${formatNumber(current)} ${nextOperator}`);
    setReplaceDisplay(true);
  };

  const toggleSign = () => {
    setDisplay((prev) => {
      if (prev === '0' || prev === 'Error') return prev;
      return prev.startsWith('-') ? prev.slice(1) : `-${prev}`;
    });
  };

  const applyPercent = () => {
    setDisplay((prev) => formatNumber((Number.parseFloat(prev) || 0) / 100));
  };

  const handleEquals = async () => {
    const pin = getStealthPin();
    const pinCandidate = display;
    if (
      pin &&
      !operator &&
      pinCandidate.length === pin.length &&
      /^\d+$/.test(pinCandidate)
    ) {
      try {
        const candidateHash = await hashStealthPin(pinCandidate);
        if (candidateHash === pin.hash) {
          resetCalculator();
          onPanic();
          return;
        }
      } catch {
        // Hashing unavailable (insecure context); fall through to calculation.
      }
    }

    const current = Number.parseFloat(display) || 0;
    if (operator && stored !== null) {
      const result = compute(stored, current, operator);
      setEquation(`${formatNumber(stored)} ${operator} ${formatNumber(current)} =`);
      setDisplay(formatNumber(result));
      setStored(null);
      setOperator(null);
    } else {
      setEquation(`${display} =`);
    }
    setReplaceDisplay(true);
  };

  const handleButton = (button) => {
    switch (button.kind) {
      case 'digit':
        inputDigit(button.label);
        break;
      case 'dot':
        inputDot();
        break;
      case 'operator':
        chooseOperator(button.label);
        break;
      case 'equals':
        handleEquals();
        break;
      case 'clear':
        resetCalculator();
        break;
      case 'sign':
        toggleSign();
        break;
      case 'percent':
        applyPercent();
        break;
      default:
        break;
    }
  };

  const handleNotesChange = (event) => {
    const value = event.target.value;
    setNotes(value);
    try {
      localStorage.setItem(NOTES_KEY, value);
    } catch {
      // Storage may be unavailable; the notepad still works for this session.
    }
  };

  const startExitHold = () => {
    clearTimeout(exitTimerRef.current);
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null;
      onExit();
    }, EXIT_HOLD_MS);
  };

  const cancelExitHold = () => {
    clearTimeout(exitTimerRef.current);
    exitTimerRef.current = null;
  };

  return (
    <div className="decoy-overlay" role="dialog" aria-label="Utilities">
      <div className="decoy-app">
        <header
          className="decoy-header"
          onPointerDown={startExitHold}
          onPointerUp={cancelExitHold}
          onPointerLeave={cancelExitHold}
          onPointerCancel={cancelExitHold}
          title="Utilities"
        >
          <div>
            <h1 className="decoy-title">Utilities</h1>
            <p className="decoy-date">
              {new Date().toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
            </p>
          </div>
          <div className="decoy-tabs">
            <button
              type="button"
              className={`decoy-tab ${tab === 'calculator' ? 'active' : ''}`}
              onClick={() => setTab('calculator')}
            >
              Calculator
            </button>
            <button
              type="button"
              className={`decoy-tab ${tab === 'notes' ? 'active' : ''}`}
              onClick={() => setTab('notes')}
            >
              Notes
            </button>
          </div>
        </header>

        {tab === 'calculator' ? (
          <div className="decoy-calculator">
            <div className="decoy-display">
              <div className="decoy-equation">{equation || '\u00a0'}</div>
              <div className="decoy-result">{display}</div>
            </div>
            <div className="decoy-keypad">
              {CALCULATOR_ROWS.flat().map((button) => (
                <button
                  key={button.label}
                  type="button"
                  className={`decoy-key ${button.className || ''}`}
                  onClick={() => handleButton(button)}
                >
                  {button.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="decoy-notes">
            <textarea
              className="decoy-notes-input"
              value={notes}
              onChange={handleNotesChange}
              placeholder="Quick note…"
              aria-label="Notes"
            />
            <span className="decoy-notes-hint">Saved on this device</span>
          </div>
        )}
      </div>
    </div>
  );
}
