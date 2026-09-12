"use client";

import { CheckIcon, ChevronsUpDownIcon, SearchIcon, XIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
  readonly code: string;
  readonly label: string;
}

interface SearchableSelectProps {
  readonly id: string;
  readonly name: string;
  readonly options: readonly SearchableSelectOption[];
  readonly placeholder: string;
  readonly searchPlaceholder: string;
  readonly noResultsText: string;
  readonly required?: boolean;
  readonly clearable?: boolean;
  readonly className?: string;
}

export function SearchableSelect({
  id,
  name,
  options,
  placeholder,
  searchPlaceholder,
  noResultsText,
  required = false,
  clearable = false,
  className,
}: SearchableSelectProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [selectedCode, setSelectedCode] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(-1);

  const selectedOption = React.useMemo(
    () => options.find((option) => option.code === selectedCode) ?? null,
    [options, selectedCode]
  );

  const filteredOptions = React.useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en");

    if (!normalizedQuery) {
      return options;
    }

    return options
      .map((option, index) => {
        const normalizedCode = option.code.toLocaleLowerCase("en");
        const normalizedLabel = option.label.toLocaleLowerCase("en");
        let rank = Number.POSITIVE_INFINITY;

        if (normalizedCode === normalizedQuery) {
          rank = 0;
        } else if (normalizedCode.startsWith(normalizedQuery)) {
          rank = 1;
        } else if (normalizedLabel.startsWith(normalizedQuery)) {
          rank = 2;
        } else if (normalizedLabel.includes(normalizedQuery)) {
          rank = 3;
        }

        return { option, index, rank };
      })
      .filter(({ rank }) => Number.isFinite(rank))
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map(({ option }) => option);
  }, [options, query]);

  const listboxId = `${id}-listbox`;
  const activeOption = activeIndex >= 0 ? filteredOptions[activeIndex] : undefined;
  const activeOptionId = activeOption
    ? `${listboxId}-option-${activeOption.code}`
    : undefined;

  const closeList = React.useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }, []);

  const openList = React.useCallback(() => {
    setIsOpen(true);
    setQuery("");
    setActiveIndex(() => {
      const selectedIndex = options.findIndex(
        (option) => option.code === selectedCode
      );
      return selectedIndex >= 0 ? selectedIndex : options.length > 0 ? 0 : -1;
    });
  }, [options, selectedCode]);

  const selectOption = React.useCallback((option: SearchableSelectOption) => {
    setSelectedCode(option.code);
    setIsOpen(false);
    setQuery("");
    setActiveIndex(-1);
    inputRef.current?.setCustomValidity("");
    inputRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        closeList();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [closeList, isOpen]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (filteredOptions.length === 0) {
      setActiveIndex(-1);
      return;
    }

    setActiveIndex((currentIndex) =>
      currentIndex < 0 || currentIndex >= filteredOptions.length
        ? 0
        : currentIndex
    );
  }, [filteredOptions.length, isOpen]);

  React.useEffect(() => {
    if (!isOpen || !activeOptionId) {
      return;
    }

    document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId, isOpen]);

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextQuery = event.target.value;

    if (!isOpen) {
      setIsOpen(true);
    }

    setQuery(nextQuery);
    setSelectedCode("");
    setActiveIndex(0);
    event.target.setCustomValidity(
      required ? "Select a value from the available options." : ""
    );
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      closeList();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();

      if (!isOpen) {
        openList();
        return;
      }

      if (filteredOptions.length > 0) {
        setActiveIndex((currentIndex) =>
          currentIndex < filteredOptions.length - 1 ? currentIndex + 1 : 0
        );
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();

      if (!isOpen) {
        openList();
        return;
      }

      if (filteredOptions.length > 0) {
        setActiveIndex((currentIndex) =>
          currentIndex > 0 ? currentIndex - 1 : filteredOptions.length - 1
        );
      }
      return;
    }

    if (event.key === "Enter") {
      if (!isOpen) {
        event.preventDefault();
        openList();
        return;
      }

      if (activeOption) {
        event.preventDefault();
        selectOption(activeOption);
      }
    }
  }

  function clearSelection() {
    setSelectedCode("");
    setQuery("");
    setActiveIndex(options.length > 0 ? 0 : -1);
    inputRef.current?.setCustomValidity("");
    inputRef.current?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={cn("relative", className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          closeList();
        }
      }}
    >
      <input type="hidden" name={name} value={selectedCode} />
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-activedescendant={isOpen ? activeOptionId : undefined}
          aria-required={required}
          required={required && !selectedCode}
          value={isOpen ? query : selectedOption?.label ?? ""}
          placeholder={isOpen ? searchPlaceholder : placeholder}
          className="w-full rounded-md border border-input bg-background py-2.5 pl-10 pr-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onFocus={() => {
            if (!isOpen) {
              openList();
            }
          }}
          onClick={() => {
            if (!isOpen) {
              openList();
            }
          }}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
        />
        <ChevronsUpDownIcon
          aria-hidden="true"
          className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>

      {isOpen ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          {selectedOption ? (
            <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs text-muted-foreground">
              <span className="truncate">Selected: {selectedOption.label}</span>
              {clearable ? (
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={clearSelection}
                >
                  <XIcon aria-hidden="true" className="size-3.5" />
                  Clear
                </button>
              ) : null}
            </div>
          ) : null}

          <div id={listboxId} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, index) => {
                const isSelected = option.code === selectedCode;
                const isActive = index === activeIndex;

                return (
                  <button
                    key={option.code}
                    id={`${listboxId}-option-${option.code}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={-1}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm outline-none",
                      isActive && "bg-accent text-accent-foreground"
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                  >
                    <CheckIcon
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0",
                        isSelected ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span>{option.label}</span>
                  </button>
                );
              })
            ) : (
              <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
                {noResultsText}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
