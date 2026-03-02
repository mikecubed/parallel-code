import { onMount, onCleanup, createSignal, Show, For } from 'solid-js';
import { toggleNewTaskDialog, createTerminal, store, unfocusPlaceholder } from '../store/store';
import { registerFocusFn, unregisterFocusFn } from '../store/focus';
import { theme } from '../lib/theme';
import { mod } from '../lib/platform';
import type { ShellType } from '../store/types';

export function NewTaskPlaceholder() {
  let addTaskRef: HTMLDivElement | undefined;
  let addTerminalRef: HTMLDivElement | undefined;
  const [shellMenuOpen, setShellMenuOpen] = createSignal(false);

  onMount(() => {
    registerFocusFn('placeholder:add-task', () => addTaskRef?.focus());
    registerFocusFn('placeholder:add-terminal', () => addTerminalRef?.focus());
    onCleanup(() => {
      unregisterFocusFn('placeholder:add-task');
      unregisterFocusFn('placeholder:add-terminal');
    });
  });

  const isFocused = (btn: 'add-task' | 'add-terminal') =>
    store.placeholderFocused && store.placeholderFocusedButton === btn;

  const focusedBorder = (btn: 'add-task' | 'add-terminal') =>
    isFocused(btn) ? `2px dashed ${theme.accent}` : `2px dashed ${theme.border}`;

  const focusedColor = (btn: 'add-task' | 'add-terminal') =>
    isFocused(btn) ? theme.accent : theme.fgSubtle;

  const focusedBg = (btn: 'add-task' | 'add-terminal') =>
    isFocused(btn) ? `color-mix(in srgb, ${theme.accent} 8%, transparent)` : undefined;

  function handleTerminalClick() {
    if (store.availableShells.length > 1) {
      setShellMenuOpen((open) => !open);
    } else {
      unfocusPlaceholder();
      createTerminal();
    }
  }

  function pickShell(id: ShellType) {
    setShellMenuOpen(false);
    unfocusPlaceholder();
    createTerminal(id);
  }

  return (
    <div
      style={{
        width: '48px',
        'min-width': '48px',
        height: 'calc(100% - 12px)',
        display: 'flex',
        'flex-direction': 'column',
        gap: '4px',
        margin: '6px 3px',
        'flex-shrink': '0',
      }}
    >
      {/* Add task button — fills remaining space */}
      <div
        ref={addTaskRef}
        class="new-task-placeholder"
        role="button"
        tabIndex={0}
        aria-label="New task"
        onClick={() => toggleNewTaskDialog(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleNewTaskDialog(true);
          }
        }}
        style={{
          flex: '1',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          cursor: 'pointer',
          'border-radius': '12px',
          border: focusedBorder('add-task'),
          color: focusedColor('add-task'),
          background: focusedBg('add-task'),
          'font-size': '20px',
          'user-select': 'none',
        }}
        title={`New task (${mod}+N)`}
      >
        +
      </div>

      {/* Terminal button — same width, fixed height */}
      <div style={{ position: 'relative' }}>
        <div
          ref={addTerminalRef}
          class="new-task-placeholder"
          role="button"
          tabIndex={0}
          aria-label="New terminal"
          aria-haspopup={store.availableShells.length > 1 ? 'listbox' : undefined}
          aria-expanded={store.availableShells.length > 1 ? shellMenuOpen() : undefined}
          onClick={handleTerminalClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleTerminalClick();
            }
            if (e.key === 'Escape' && shellMenuOpen()) {
              e.preventDefault();
              setShellMenuOpen(false);
            }
          }}
          style={{
            height: '44px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            cursor: 'pointer',
            'border-radius': '10px',
            border: focusedBorder('add-terminal'),
            color: focusedColor('add-terminal'),
            background: focusedBg('add-terminal'),
            'font-size': '13px',
            'font-family': 'monospace',
            'user-select': 'none',
            'flex-shrink': '0',
          }}
          title={`New terminal (${mod}+Shift+D)`}
        >
          &gt;_
        </div>

        {/* Shell picker dropdown — only shown on Windows with multiple shells */}
        <Show when={shellMenuOpen()}>
          <div
            role="listbox"
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 4px)',
              left: '0',
              'min-width': '180px',
              background: theme.bgElevated,
              border: `1px solid ${theme.border}`,
              'border-radius': '8px',
              'box-shadow': '0 8px 24px rgba(0,0,0,0.4)',
              padding: '4px',
              'z-index': '20',
            }}
          >
            <For each={store.availableShells}>
              {(shell) => (
                <button
                  type="button"
                  role="option"
                  onClick={() => pickShell(shell.id)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    'border-radius': '6px',
                    padding: '7px 10px',
                    color: theme.fg,
                    'font-size': '12px',
                    'text-align': 'left',
                    cursor: 'pointer',
                    'white-space': 'nowrap',
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      `color-mix(in srgb, ${theme.accent} 10%, transparent)`)
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')
                  }
                >
                  {shell.label}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
