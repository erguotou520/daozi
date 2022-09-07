import { Component, createApp, createVNode, render, VNode } from 'vue'

export const mount = (component: Component, { props, children }: { props?: Record<string, any>, children?: VNode } = {}) => {
  let el: HTMLDivElement | null = document.createElement('div')
  document.body.appendChild(el)
  // let vNode: VNode | null = createVNode(component, props, children)
  // render(vNode, el)

  const app = createApp(component)
  app.mount(el)


  const destroy = () => {
    if (el) render(null, el)
    el = null
    // vNode = null
  }

  return { destroy, el }
}
