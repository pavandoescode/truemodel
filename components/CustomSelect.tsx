'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';

export interface Option {
  value: string;
  label: React.ReactNode;
}

export interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  className?: string;
  'aria-label'?: string;
}

export function CustomSelect({ value, onChange, options, className, 'aria-label': ariaLabel }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value) || options[0];

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    // Index against `options` directly. Filtering by which <li> refs happen to
    // be populated shifted the indices out of step with the rendered list
    // (refs from a previous, longer list are never cleared), so Enter could
    // select a different option than the one highlighted.
    const maxIndex = options.length - 1;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          setHighlightedIndex(0);
        } else {
          setHighlightedIndex((i) => Math.min(i + 1, maxIndex));
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (isOpen) {
          setHighlightedIndex((i) => Math.max(i - 1, 0));
        }
        break;
      case 'Home':
        event.preventDefault();
        if (isOpen) setHighlightedIndex(0);
        break;
      case 'End':
        event.preventDefault();
        if (isOpen) setHighlightedIndex(maxIndex);
        break;
      case 'Enter':
      case ' ':
        if (isOpen && highlightedIndex >= 0) {
          event.preventDefault();
          const opt = options[highlightedIndex];
          if (opt) {
            onChange(opt.value);
            setIsOpen(false);
          }
        } else if (!isOpen) {
          event.preventDefault();
          setIsOpen(true);
        }
        break;
      case 'Escape':
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Tab':
        setIsOpen(false);
        break;
    }
  }, [isOpen, highlightedIndex, onChange, options]);

  const handleOptionKeyDown = useCallback((event: React.KeyboardEvent, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const opt = options[index];
      if (opt) {
        onChange(opt.value);
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  }, [onChange, options]);

  // Sync highlighted index with current selection when opening
  useEffect(() => {
    if (isOpen) {
      const idx = options.findIndex((opt) => opt.value === value);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen, value, options]);

  return (
    <div
      className={`customSelect ${className || ''}`}
      ref={containerRef}
      style={{ zIndex: isOpen ? 100 : undefined }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`customSelectTrigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-activedescendant={isOpen && highlightedIndex >= 0 ? `option-${highlightedIndex}` : undefined}
      >
        <span className="customSelectValue">{selectedOption?.label}</span>
        <ChevronDown size={16} className="customSelectIcon" />
      </button>

      {isOpen && (
        <ul className="customSelectMenu" role="listbox">
          {options.map((opt, index) => (
            <li
              key={opt.value}
              id={`option-${index}`}
              className={`customSelectOption ${opt.value === value ? 'selected' : ''} ${highlightedIndex === index ? 'highlighted' : ''}`}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              onKeyDown={(e) => handleOptionKeyDown(e, index)}
              role="option"
              aria-selected={opt.value === value}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
