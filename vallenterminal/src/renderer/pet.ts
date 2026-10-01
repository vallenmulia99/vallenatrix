// Ultra-lightweight Pixel Pet for Vallenatrix Terminal
// Zero heavy assets, pure SVG pixel art, minimal CPU footprint (<0.05%)

export interface PetOptions {
  container: HTMLElement
}

const FRAMES = {
  walk1: `<svg viewBox="0 0 16 12" width="36" height="27" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <rect x="10" y="0" width="1" height="2" fill="#ff2a6d"/>
    <rect x="11" y="1" width="1" height="1" fill="#22252a"/>
    <rect x="13" y="0" width="1" height="2" fill="#ff2a6d"/>
    <rect x="14" y="1" width="1" height="1" fill="#22252a"/>
    <rect x="9" y="2" width="6" height="5" fill="#22252a"/>
    <rect x="13" y="3" width="1" height="2" fill="#05d9e8"/>
    <rect x="11" y="3" width="1" height="2" fill="#05d9e8"/>
    <rect x="14" y="4" width="2" height="1" fill="#ffffff" opacity="0.7"/>
    <rect x="12" y="5" width="1" height="1" fill="#ff2a6d"/>
    <rect x="9" y="6" width="5" height="1" fill="#ff2a6d"/>
    <rect x="10" y="7" width="1" height="1" fill="#ffd166"/>
    <rect x="3" y="5" width="7" height="4" fill="#22252a"/>
    <rect x="5" y="7" width="4" height="2" fill="#ffffff"/>
    <rect x="2" y="4" width="1" height="2" fill="#22252a"/>
    <rect x="1" y="2" width="1" height="3" fill="#22252a"/>
    <rect x="2" y="1" width="1" height="1" fill="#05d9e8"/>
    <rect x="4" y="9" width="1" height="2" fill="#22252a"/>
    <rect x="3" y="11" width="2" height="1" fill="#ffffff"/>
    <rect x="8" y="9" width="1" height="2" fill="#22252a"/>
    <rect x="9" y="11" width="2" height="1" fill="#ffffff"/>
  </svg>`,

  walk2: `<svg viewBox="0 0 16 12" width="36" height="27" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <rect x="10" y="0" width="1" height="2" fill="#ff2a6d"/>
    <rect x="11" y="1" width="1" height="1" fill="#22252a"/>
    <rect x="13" y="0" width="1" height="2" fill="#ff2a6d"/>
    <rect x="14" y="1" width="1" height="1" fill="#22252a"/>
    <rect x="9" y="2" width="6" height="5" fill="#22252a"/>
    <rect x="13" y="3" width="1" height="2" fill="#05d9e8"/>
    <rect x="11" y="3" width="1" height="2" fill="#05d9e8"/>
    <rect x="14" y="4" width="2" height="1" fill="#ffffff" opacity="0.7"/>
    <rect x="12" y="5" width="1" height="1" fill="#ff2a6d"/>
    <rect x="9" y="6" width="5" height="1" fill="#ff2a6d"/>
    <rect x="10" y="7" width="1" height="1" fill="#ffd166"/>
    <rect x="3" y="5" width="7" height="4" fill="#22252a"/>
    <rect x="5" y="7" width="4" height="2" fill="#ffffff"/>
    <rect x="2" y="5" width="1" height="2" fill="#22252a"/>
    <rect x="1" y="4" width="1" height="2" fill="#22252a"/>
    <rect x="1" y="3" width="1" height="1" fill="#05d9e8"/>
    <rect x="5" y="9" width="1" height="2" fill="#22252a"/>
    <rect x="5" y="11" width="2" height="1" fill="#ffffff"/>
    <rect x="7" y="9" width="1" height="2" fill="#22252a"/>
    <rect x="7" y="11" width="2" height="1" fill="#ffffff"/>
  </svg>`,

  sit: `<svg viewBox="0 0 16 12" width="36" height="27" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <rect x="9" y="1" width="1" height="2" fill="#ff2a6d"/>
    <rect x="10" y="2" width="1" height="1" fill="#22252a"/>
    <rect x="12" y="1" width="1" height="2" fill="#ff2a6d"/>
    <rect x="13" y="2" width="1" height="1" fill="#22252a"/>
    <rect x="8" y="3" width="6" height="5" fill="#22252a"/>
    <rect x="12" y="4" width="1" height="2" fill="#05d9e8"/>
    <rect x="10" y="4" width="1" height="2" fill="#05d9e8"/>
    <rect x="13" y="5" width="2" height="1" fill="#ffffff" opacity="0.7"/>
    <rect x="11" y="6" width="1" height="1" fill="#ff2a6d"/>
    <rect x="8" y="7" width="5" height="1" fill="#ff2a6d"/>
    <rect x="4" y="6" width="6" height="5" fill="#22252a"/>
    <rect x="6" y="8" width="3" height="3" fill="#ffffff"/>
    <rect x="3" y="8" width="1" height="3" fill="#22252a"/>
    <rect x="4" y="11" width="6" height="1" fill="#22252a"/>
    <rect x="9" y="11" width="1" height="1" fill="#05d9e8"/>
    <rect x="6" y="10" width="3" height="1" fill="#ffffff"/>
  </svg>`,

  sleep: `<svg viewBox="0 0 16 12" width="36" height="27" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <rect x="11" y="5" width="2" height="1" fill="#ff2a6d"/>
    <rect x="13" y="6" width="1" height="1" fill="#22252a"/>
    <rect x="9" y="6" width="5" height="4" fill="#22252a"/>
    <rect x="11" y="7" width="2" height="1" fill="#05d9e8"/>
    <rect x="3" y="7" width="7" height="4" fill="#22252a"/>
    <rect x="5" y="9" width="4" height="2" fill="#ffffff"/>
    <rect x="4" y="11" width="6" height="1" fill="#ffffff"/>
    <rect x="2" y="8" width="1" height="2" fill="#22252a"/>
    <rect x="1" y="9" width="1" height="2" fill="#05d9e8"/>
  </svg>`
}

const MEOWS = ['nya~', 'nyaan!', '(=^･ω･^=)', 'vallen! ♥', 'purrr...', 'typing master! ✨', 'semangat! 🔥']

export class TerminalPet {
  private parent: HTMLElement
  private petEl: HTMLDivElement
  private spriteEl: HTMLDivElement
  private bubbleEl: HTMLDivElement

  private posX: number = 20
  private direction: number = 1 // 1: right, -1: left
  private state: 'walking' | 'idle' | 'sleeping' = 'walking'
  private walkStep: number = 0
  private stateTimer: number = 0
  private bubbleTimeout: number | null = null
  private loopId: number | null = null
  private enabled: boolean = true
  private scale: number = 1.0

  constructor(parent: HTMLElement) {
    this.parent = parent

    // Container element
    this.petEl = document.createElement('div')
    this.petEl.id = 'vallen-pet'
    this.petEl.className = 'terminal-pet'
    this.petEl.title = 'Vallenatrix Pet! (Klik untuk meow, Scroll untuk ubah ukuran)'

    // Speech bubble
    this.bubbleEl = document.createElement('div')
    this.bubbleEl.className = 'pet-bubble'
    this.petEl.appendChild(this.bubbleEl)

    // Sprite container
    this.spriteEl = document.createElement('div')
    this.spriteEl.className = 'pet-sprite'
    this.spriteEl.innerHTML = FRAMES.walk1
    this.petEl.appendChild(this.spriteEl)

    this.parent.appendChild(this.petEl)

    // Interaction on click
    this.petEl.addEventListener('click', () => this.meow())

    // Interaction on scroll wheel (resize pet directly)
    this.petEl.addEventListener('wheel', (e) => {
      e.preventDefault()
      const delta = e.deltaY < 0 ? 0.1 : -0.1
      this.setScale(this.scale + delta)
      const cb = (window as any).onPetScaleChange
      if (typeof cb === 'function') cb(this.scale)
    })

    // Check stored scale preference
    const savedScale = localStorage.getItem('vallen_pet_scale')
    if (savedScale) {
      const parsed = parseFloat(savedScale)
      if (!isNaN(parsed) && parsed >= 0.4 && parsed <= 3.0) {
        this.scale = parsed
      }
    }

    // Check stored enabled preference
    const saved = localStorage.getItem('vallen_pet_enabled')
    if (saved === 'false') {
      this.setEnabled(false)
    } else {
      this.start()
    }
  }

  public setScale(scale: number): void {
    this.scale = Math.max(0.4, Math.min(3.0, Math.round(scale * 100) / 100))
    localStorage.setItem('vallen_pet_scale', this.scale.toString())
    this.updatePosition(0)
  }

  public getScale(): number {
    return this.scale
  }

  public setEnabled(enable: boolean): void {
    this.enabled = enable
    localStorage.setItem('vallen_pet_enabled', enable ? 'true' : 'false')
    if (enable) {
      this.petEl.style.display = 'block'
      this.start()
    } else {
      this.petEl.style.display = 'none'
      this.stop()
    }
  }

  public isEnabled(): boolean {
    return this.enabled
  }

  public onUserActivity(): void {
    if (!this.enabled) return
    // Wake up if sleeping and cheer user
    if (this.state === 'sleeping') {
      this.state = 'idle'
      this.stateTimer = 10
      this.spriteEl.innerHTML = FRAMES.sit
      this.showBubble('nya!')
    }
  }

  public meow(): void {
    if (!this.enabled) return
    // Cute hop animation
    this.petEl.style.transition = 'transform 0.15s ease-out'
    this.updatePosition(-12)
    setTimeout(() => {
      this.petEl.style.transition = 'none'
      this.updatePosition(0)
    }, 150)

    const randomMsg = MEOWS[Math.floor(Math.random() * MEOWS.length)]
    this.showBubble(randomMsg)
    this.state = 'idle'
    this.stateTimer = 15
    this.spriteEl.innerHTML = FRAMES.sit
  }

  private showBubble(text: string): void {
    if (this.bubbleTimeout) clearTimeout(this.bubbleTimeout)
    this.bubbleEl.textContent = text
    this.bubbleEl.classList.add('show')
    this.bubbleTimeout = window.setTimeout(() => {
      this.bubbleEl.classList.remove('show')
      this.bubbleTimeout = null
    }, 1800)
  }

  private start(): void {
    if (this.loopId !== null) return
    this.loopId = window.setInterval(() => this.tick(), 120)
  }

  private stop(): void {
    if (this.loopId !== null) {
      clearInterval(this.loopId)
      this.loopId = null
    }
  }

  private tick(): void {
    if (!this.enabled) return

    const parentWidth = this.parent.clientWidth || 800
    const minX = 10
    const maxX = Math.max(minX + 50, parentWidth - (36 * this.scale + 12))

    if (this.state === 'walking') {
      this.posX += this.direction * 3.5
      this.walkStep = (this.walkStep + 1) % 2
      this.spriteEl.innerHTML = this.walkStep === 0 ? FRAMES.walk1 : FRAMES.walk2

      // Check boundary turnarounds
      if (this.posX >= maxX) {
        this.posX = maxX
        this.direction = -1
        this.maybeRest()
      } else if (this.posX <= minX) {
        this.posX = minX
        this.direction = 1
        this.maybeRest()
      } else if (Math.random() < 0.015) {
        // Random chance to pause mid-walk
        this.maybeRest()
      }

      this.updatePosition(0)
    } else if (this.state === 'idle') {
      this.stateTimer--
      this.spriteEl.innerHTML = FRAMES.sit
      if (this.stateTimer <= 0) {
        // Either walk or sleep
        if (Math.random() < 0.3) {
          this.state = 'sleeping'
          this.stateTimer = 40 + Math.floor(Math.random() * 30) // sleep for ~5-8s
          this.spriteEl.innerHTML = FRAMES.sleep
          if (Math.random() < 0.5) this.showBubble('z Z z')
        } else {
          this.state = 'walking'
        }
      }
    } else if (this.state === 'sleeping') {
      this.stateTimer--
      this.spriteEl.innerHTML = FRAMES.sleep
      if (this.stateTimer % 20 === 0 && Math.random() < 0.6) {
        this.showBubble('z Z')
      }
      if (this.stateTimer <= 0) {
        this.state = 'idle'
        this.stateTimer = 15
        this.spriteEl.innerHTML = FRAMES.sit
      }
    }
  }

  private maybeRest(): void {
    if (Math.random() < 0.45) {
      this.state = 'idle'
      this.stateTimer = 20 + Math.floor(Math.random() * 25) // sit for 2.5 - 5 seconds
      this.spriteEl.innerHTML = FRAMES.sit
    }
  }

  private updatePosition(offsetY: number = 0): void {
    const dir = this.direction === 1 ? 1 : -1
    const sx = dir * this.scale
    const sy = this.scale
    this.petEl.style.transform = `translate3d(${Math.round(this.posX)}px, ${offsetY}px, 0) scale(${sx}, ${sy})`
  }
}
