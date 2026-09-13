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

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SceneId } from '../../kernel/ids';
import { useEditor, useEditorState } from '../EditorContext';

interface MenuState {
  readonly sceneId: SceneId;
  readonly x: number;
  readonly y: number;
}

/**
 * One tab per scene above the view. Click (or Enter) shows the scene; the context menu (right-click, the Menu key or
 * Shift+F10) updates, moves or deletes it. Arrow keys move between tabs.
 */
export function SceneTabs() {
  const editor = useEditor();
  const scenes = useEditorState((state) => state.scenes);
  const activeSceneId = useEditorState((state) => state.activeSceneId);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const tabRefs = useRef(new Map<number, HTMLButtonElement>());
  const menuRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
    };
  }, [menu]);

  if (scenes.length === 0) return null;

  const focusTab = (index: number) => {
    const scene = scenes[(index + scenes.length) % scenes.length];
    if (scene) tabRefs.current.get(scene.id)?.focus();
  };

  const openMenu = (sceneId: SceneId, x: number, y: number) => {
    const strip = stripRef.current?.getBoundingClientRect();
    setMenu({ sceneId, x: x - (strip?.left ?? 0), y: y - (strip?.top ?? 0) });
  };

  const closeMenu = () => {
    const sceneId = menu?.sceneId;
    setMenu(null);
    if (sceneId !== undefined) tabRefs.current.get(sceneId)?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, sceneId: SceneId) => {
    if (event.key === 'ArrowRight') focusTab(index + 1);
    else if (event.key === 'ArrowLeft') focusTab(index - 1);
    else if (event.key === 'Home') focusTab(0);
    else if (event.key === 'End') focusTab(scenes.length - 1);
    else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      const rect = event.currentTarget.getBoundingClientRect();
      openMenu(sceneId, rect.left, rect.bottom);
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const menuScene = menu ? scenes.find((scene) => scene.id === menu.sceneId) : undefined;
  const menuIndex = menuScene ? scenes.indexOf(menuScene) : -1;
  const run = (action: () => void) => {
    closeMenu();
    action();
  };

  return (
    <div className="scene-tabs" ref={stripRef}>
      <div className="scene-tabs__list" role="tablist" aria-label="Scenes">
        {scenes.map((scene, index) => {
          const selected = scene.id === activeSceneId;
          const focusable = selected || (activeSceneId === null && index === 0);
          return (
            <button
              key={scene.id}
              ref={(element) => {
                if (element) tabRefs.current.set(scene.id, element);
                else tabRefs.current.delete(scene.id);
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={focusable ? 0 : -1}
              title={scene.description || scene.name}
              className={`scene-tabs__tab${selected ? ' scene-tabs__tab--active' : ''}`}
              onClick={() => {
                editor.applyScene(scene.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu(scene.id, event.clientX, event.clientY);
              }}
              onKeyDown={(event) => {
                onTabKeyDown(event, index, scene.id);
              }}
            >
              {scene.name}
            </button>
          );
        })}
      </div>
      {menu && menuScene && (
        <div
          ref={menuRef}
          className="menu scene-tabs__menu"
          role="menu"
          aria-label={`${menuScene.name} actions`}
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={(event) => {
            const items = [
              ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
            ];
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'ArrowDown') items[(current + 1) % items.length]?.focus();
            else if (event.key === 'ArrowUp') items[(current - 1 + items.length) % items.length]?.focus();
            else if (event.key === 'Escape' || event.key === 'Tab') closeMenu();
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              run(() => {
                editor.updateSceneFromView(menuScene.id);
              });
            }}
          >
            <span className="menu__check" aria-hidden="true" />
            <span className="menu__label">Update Scene</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            disabled={menuIndex <= 0}
            onClick={() => {
              run(() => {
                editor.moveScene(menuScene.id, -1);
              });
            }}
          >
            <span className="menu__check" aria-hidden="true" />
            <span className="menu__label">Move Left</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            disabled={menuIndex >= scenes.length - 1}
            onClick={() => {
              run(() => {
                editor.moveScene(menuScene.id, 1);
              });
            }}
          >
            <span className="menu__check" aria-hidden="true" />
            <span className="menu__label">Move Right</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              run(() => {
                editor.removeScene(menuScene.id);
              });
            }}
          >
            <span className="menu__check" aria-hidden="true" />
            <span className="menu__label">Delete Scene</span>
          </button>
        </div>
      )}
    </div>
  );
}
