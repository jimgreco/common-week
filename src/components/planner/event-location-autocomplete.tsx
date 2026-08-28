"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, MapPin } from "lucide-react";
import type { EventLocationSuggestion, ResolvedEventLocation } from "@/types/domain";

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const demoSuggestions: EventLocationSuggestion[] = [
  { placeId: "demo-wolffer", primaryText: "Wölffer Estate Vineyard", secondaryText: "Sagg Road, Sagaponack, NY, USA", fullText: "Wölffer Estate Vineyard, Sagg Road, Sagaponack, NY, USA" },
  { placeId: "demo-airport", primaryText: "East Hampton Airport", secondaryText: "Daniels Hole Road, Wainscott, NY, USA", fullText: "East Hampton Airport, Daniels Hole Road, Wainscott, NY, USA" },
  { placeId: "demo-yankee-stadium", primaryText: "Yankee Stadium", secondaryText: "East 161st Street, Bronx, NY, USA", fullText: "Yankee Stadium, East 161st Street, Bronx, NY, USA" },
];

const normalizeSearchText = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

export function EventLocationAutocomplete({
  value,
  onChange,
  bias,
  isDemo = false,
}: {
  value: string;
  onChange: (value: string) => void;
  bias?: { latitude: number; longitude: number };
  isDemo?: boolean;
}) {
  const inputId = useId();
  const resultsId = useId();
  const [suggestions, setSuggestions] = useState<EventLocationSuggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedText = useRef<string | null>(null);
  const userHasEdited = useRef(false);
  const sessionToken = useRef(crypto.randomUUID());

  useEffect(() => {
    const query = value.trim();
    if (!userHasEdited.current) return;
    if (selectedText.current === value) return;
    if (query.length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        let nextSuggestions: EventLocationSuggestion[];
        if (isDemo) {
          const normalizedQuery = normalizeSearchText(query);
          nextSuggestions = demoSuggestions.filter((suggestion) => normalizeSearchText(suggestion.fullText).includes(normalizedQuery));
        } else {
          const parameters = new URLSearchParams({ q: query, sessionToken: sessionToken.current });
          if (bias) {
            parameters.set("latitude", String(bias.latitude));
            parameters.set("longitude", String(bias.longitude));
          }
          const result = await fetch(`/api/event-locations?${parameters}`, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          });
          const envelope = await result.json() as Envelope<EventLocationSuggestion[]>;
          if (!result.ok || !envelope.ok) throw new Error(envelope.error ?? "Location suggestions are temporarily unavailable.");
          nextSuggestions = envelope.data ?? [];
        }
        setSuggestions(nextSuggestions);
        setActiveSuggestion(nextSuggestions.length ? 0 : -1);
      } catch (searchError) {
        if (searchError instanceof DOMException && searchError.name === "AbortError") return;
        setSuggestions([]);
        setActiveSuggestion(-1);
        setError(searchError instanceof Error ? searchError.message : "Location suggestions are temporarily unavailable.");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [bias, isDemo, value]);

  const chooseSuggestion = async (suggestion: EventLocationSuggestion) => {
    selectedText.current = suggestion.fullText;
    onChange(suggestion.fullText);
    setSuggestions([]);
    setActiveSuggestion(-1);
    setError(null);
    if (isDemo) {
      sessionToken.current = crypto.randomUUID();
      return;
    }

    setResolving(true);
    try {
      const result = await fetch("/api/event-locations", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          placeId: suggestion.placeId,
          sessionToken: sessionToken.current,
          suggestedText: suggestion.fullText,
        }),
      });
      const envelope = await result.json() as Envelope<ResolvedEventLocation>;
      if (!result.ok || !envelope.ok || !envelope.data) throw new Error(envelope.error ?? "The selected location could not be confirmed.");
      selectedText.current = envelope.data.location;
      onChange(envelope.data.location);
    } catch (resolveError) {
      setError(resolveError instanceof Error ? `${resolveError.message} You can still save the entered location.` : "The selected location could not be confirmed. You can still save it as entered.");
    } finally {
      sessionToken.current = crypto.randomUUID();
      setResolving(false);
    }
  };

  return (
    <div className="event-location-autocomplete">
      <label htmlFor={inputId}>Location</label>
      <div className="event-location-input">
        <MapPin size={15} />
        <input
          id={inputId}
          value={value}
          maxLength={1000}
          placeholder="Optional · search an address or place"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          aria-controls={resultsId}
          aria-activedescendant={activeSuggestion >= 0 ? `${resultsId}-${activeSuggestion}` : undefined}
          autoComplete="off"
          onChange={(event) => {
            userHasEdited.current = true;
            selectedText.current = null;
            setSuggestions([]);
            setActiveSuggestion(-1);
            setSearching(false);
            onChange(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length) {
              event.preventDefault();
              setActiveSuggestion((current) => (current + 1) % suggestions.length);
            } else if (event.key === "ArrowUp" && suggestions.length) {
              event.preventDefault();
              setActiveSuggestion((current) => current <= 0 ? suggestions.length - 1 : current - 1);
            } else if (event.key === "Enter" && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
              event.preventDefault();
              void chooseSuggestion(suggestions[activeSuggestion]);
            } else if (event.key === "Escape" && suggestions.length) {
              event.preventDefault();
              event.stopPropagation();
              setSuggestions([]);
              setActiveSuggestion(-1);
            }
          }}
        />
        {(searching || resolving) && <LoaderCircle className="spin" size={15} aria-label={resolving ? "Confirming location" : "Searching locations"} />}
      </div>
      {suggestions.length > 0 && (
        <div className="event-location-results" id={resultsId} role="listbox" aria-label="Event location suggestions">
          {suggestions.map((suggestion, index) => (
            <button
              id={`${resultsId}-${index}`}
              className={index === activeSuggestion ? "is-active" : ""}
              type="button"
              role="option"
              aria-selected={index === activeSuggestion}
              key={suggestion.placeId}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void chooseSuggestion(suggestion)}
            >
              <MapPin size={14} />
              <span><strong>{suggestion.primaryText}</strong><small>{suggestion.secondaryText}</small></span>
            </button>
          ))}
          <div className="google-maps-attribution" translate="no">Google Maps</div>
        </div>
      )}
      {error && <p className="event-location-error" role="status">{error}</p>}
    </div>
  );
}
