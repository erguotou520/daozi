import { inject, InjectionKey } from 'vue'

type LayoutState = {
  setTitle: (v: string) => void
}

export const layoutKey: InjectionKey<LayoutState> = Symbol()

export function useTitle(title: string) {
  const state = inject<LayoutState>(layoutKey)
  state?.setTitle(title)
}
