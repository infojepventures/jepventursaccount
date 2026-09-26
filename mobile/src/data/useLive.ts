import { onSnapshot, type DocumentData, type DocumentReference, type Query } from 'firebase/firestore';
import { useEffect, useState } from 'react';

export interface Live<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

/** Subscribes to a query. `key` must change whenever the query changes. */
export function useLiveQuery<T>(q: Query | null, key: string, map: (id: string, data: DocumentData) => T): Live<T[]> {
  const [state, setState] = useState<Live<T[]>>({ data: [], loading: !!q, error: null });
  useEffect(() => {
    if (!q) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      q,
      (snap) => setState({ data: snap.docs.map((d) => map(d.id, d.data())), loading: false, error: null }),
      (err) => setState({ data: [], loading: false, error: err.message }),
    );
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function useLiveDoc<T>(
  ref: DocumentReference | null,
  key: string,
  map: (id: string, data: DocumentData) => T,
): Live<T | null> {
  const [state, setState] = useState<Live<T | null>>({ data: null, loading: !!ref, error: null });
  useEffect(() => {
    if (!ref) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    return onSnapshot(
      ref,
      (snap) => setState({ data: snap.exists() ? map(snap.id, snap.data()) : null, loading: false, error: null }),
      (err) => setState({ data: null, loading: false, error: err.message }),
    );
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
