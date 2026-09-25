/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useEffect, useState } from 'react';
import { createStore } from 'zustand/vanilla';

/** Below this width the panels leave the window's side and open over the view as a drawer. */
export const NARROW_LAYOUT_QUERY = '(max-width: 700px)';

/** Whether the panel drawer is open (on narrow screens; on wide ones the panels are always shown). */
export const dockDrawerStore = createStore<{ readonly open: boolean }>(() => ({ open: false }));

export function setDockDrawerOpen(open: boolean): void {
  dockDrawerStore.setState({ open });
}

/** Follows a media query, such as the narrow layout's. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => {
      setMatches(list.matches);
    };
    update();
    list.addEventListener('change', update);
    return () => {
      list.removeEventListener('change', update);
    };
  }, [query]);
  return matches;
}
