'use client';
import React, { useState, useCallback, useRef } from 'react';
import { Timer, Gauge, X, Brain, Feather, Wind, BookOpen, Cpu } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import styles from '@/app/page.module.css';

export interface DragModel {
  id: string;
  latencyMs?: number | null;
  tokensPerSec?: number | null;
}

export interface SlotDef {
  key: string;
  label: string;
  Icon: LucideIcon;
}

/* Slots are identities, not magnitudes or states — so they carry an icon and a
   name, and no color of their own. Tinting them would either duplicate a hue
   (opus and sonnet both resolved to the same one) or borrow a reserved status
   color for something that is not a status. */
export const CLAUDE_CODE_SLOTS: SlotDef[] = [
  { key: 'opus',   label: 'Opus',   Icon: Brain },
  { key: 'sonnet', label: 'Sonnet', Icon: Feather },
  { key: 'haiku',  label: 'Haiku',  Icon: Wind },
  { key: 'fable',  label: 'Fable',  Icon: BookOpen },
];

export const OPENCODE_SLOTS: SlotDef[] = [
  { key: 'model', label: 'Default Model', Icon: Cpu },
];

interface Props {
  models: DragModel[];
  slots: SlotDef[];
  mappings: Record<string, string>;
  onChange: (mappings: Record<string, string>) => void;
}

export function DragDropModelMapper({ models, slots, mappings, onChange }: Props) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  // The armed model for tap/keyboard assignment: click a card to select it,
  // then click a slot to drop it there. Drag-and-drop still works; this is the
  // path for touch devices and keyboard users, where HTML5 DnD never fires.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragCounter = useRef<Record<string, number>>({});

  const handleDragStart = useCallback((e: React.DragEvent, modelId: string) => {
    e.dataTransfer.setData('text/plain', modelId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedId(modelId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragOverSlot(null);
    dragCounter.current = {};
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent, slotKey: string) => {
    e.preventDefault();
    dragCounter.current[slotKey] = (dragCounter.current[slotKey] || 0) + 1;
    setDragOverSlot(slotKey);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragLeave = useCallback((slotKey: string) => {
    dragCounter.current[slotKey] = Math.max(0, (dragCounter.current[slotKey] || 0) - 1);
    if (dragCounter.current[slotKey] === 0) {
      setDragOverSlot((prev) => (prev === slotKey ? null : prev));
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, slotKey: string) => {
      e.preventDefault();
      const modelId = e.dataTransfer.getData('text/plain');
      if (modelId) {
        onChange({ ...mappings, [slotKey]: modelId });
      }
      setDragOverSlot(null);
      setDraggedId(null);
      dragCounter.current = {};
    },
    [mappings, onChange],
  );

  // Tap/keyboard: toggle a card as the armed selection.
  const toggleSelect = useCallback((modelId: string) => {
    setSelectedId((prev) => (prev === modelId ? null : modelId));
  }, []);

  // Tap/keyboard: assign the armed model to a slot, then disarm.
  const assignToSlot = useCallback(
    (slotKey: string) => {
      if (!selectedId) return;
      onChange({ ...mappings, [slotKey]: selectedId });
      setSelectedId(null);
    },
    [selectedId, mappings, onChange],
  );

  const clearMapping = useCallback(
    (slotKey: string) => {
      onChange({ ...mappings, [slotKey]: '' });
    },
    [mappings, onChange],
  );

  return (
    <div className={styles.dndMapper}>
      {/* Available models pool */}
      <div className={styles.dndPool}>
        <span className={styles.dndPoolLabel}>
          {selectedId ? 'Now click an alias slot to assign' : 'Drag a model onto a slot, or tap to select then tap a slot'}
        </span>
        <div className={styles.dndPoolList}>
          {models.map((m) => {
            const armed = selectedId === m.id;
            return (
              <div
                key={m.id}
                role="button"
                tabIndex={0}
                aria-pressed={armed}
                className={`${styles.dndCard} ${draggedId === m.id ? styles.dndCardDragging : ''} ${armed ? styles.dndCardSelected : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, m.id)}
                onDragEnd={handleDragEnd}
                onClick={() => toggleSelect(m.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleSelect(m.id);
                  }
                }}
                title={armed ? `${m.id} selected — click a slot` : `Drag or tap to assign ${m.id}`}
              >
                <span className={styles.dndCardName}>{m.id}</span>
                <div className={styles.dndCardMetrics}>
                  {m.latencyMs != null && (
                    <span className={styles.dndMetricBadge} data-kind="latency">
                      <Timer size={11} aria-hidden="true" /> {m.latencyMs}ms
                    </span>
                  )}
                  {m.tokensPerSec != null && (
                    <span className={styles.dndMetricBadge} data-kind="throughput">
                      <Gauge size={11} aria-hidden="true" /> {m.tokensPerSec.toFixed(1)} t/s
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {models.length === 0 && (
            <span className="hint">No tested models available yet — run tests first.</span>
          )}
        </div>
      </div>

      {/* Drop zones */}
      <div className={`${styles.dndSlots} ${slots.length === 1 ? styles.dndSlotsSingle : ''}`}>
        {slots.map((slot) => {
          const mapped = mappings[slot.key];
          const model = mapped ? models.find((m) => m.id === mapped) : null;
          const isOver = dragOverSlot === slot.key;

          return (
            <div
              key={slot.key}
              role={selectedId ? 'button' : undefined}
              tabIndex={selectedId ? 0 : undefined}
              aria-label={selectedId ? `Assign ${selectedId} to ${slot.label}` : undefined}
              className={`${styles.dndSlot} ${isOver ? styles.dndSlotOver : ''} ${mapped ? styles.dndSlotFilled : ''} ${selectedId ? styles.dndSlotArmed : ''}`}
              onDragEnter={(e) => handleDragEnter(e, slot.key)}
              onDragOver={handleDragOver}
              onDragLeave={() => handleDragLeave(slot.key)}
              onDrop={(e) => handleDrop(e, slot.key)}
              onClick={() => assignToSlot(slot.key)}
              onKeyDown={(e) => {
                if (selectedId && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  assignToSlot(slot.key);
                }
              }}
            >
              <div className={styles.dndSlotHeader}>
                <span className={styles.dndSlotIcon}>
                  <slot.Icon size={15} aria-hidden="true" />
                </span>
                <span className={styles.dndSlotAlias}>{slot.label}</span>
              </div>

              {mapped ? (
                <div className={styles.dndSlotCard}>
                  <div className={styles.dndSlotCardInfo}>
                    <span className={styles.dndSlotCardName}>{mapped}</span>
                    <div className={styles.dndCardMetrics}>
                      {model?.latencyMs != null && (
                        <span className={styles.dndMetricBadge} data-kind="latency">
                          <Timer size={11} aria-hidden="true" /> {model.latencyMs}ms
                        </span>
                      )}
                      {model?.tokensPerSec != null && (
                        <span className={styles.dndMetricBadge} data-kind="throughput">
                          <Gauge size={11} aria-hidden="true" /> {model.tokensPerSec.toFixed(1)} t/s
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.dndSlotClear}
                    onClick={() => clearMapping(slot.key)}
                    aria-label={`Remove ${mapped} from ${slot.label}`}
                    title="Remove mapping"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className={styles.dndSlotEmpty}>
                  <span>{isOver ? 'Drop here!' : 'Drop a model here'}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
