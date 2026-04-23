import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

const NOTICE_TRANSITION_CLASS = 'notice-transition-leave-clone';
const NOTICE_TRANSITION_MS = 220;
const NOTICE_TRANSITION_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const NOTICE_TRANSITION_STYLE = [
  `height ${NOTICE_TRANSITION_MS}ms ${NOTICE_TRANSITION_EASING}`,
  `margin-block-start ${NOTICE_TRANSITION_MS}ms ${NOTICE_TRANSITION_EASING}`,
  `margin-block-end ${NOTICE_TRANSITION_MS}ms ${NOTICE_TRANSITION_EASING}`,
  `opacity ${NOTICE_TRANSITION_MS}ms ease`
].join(', ');

@Directive({
  selector: '.notice',
  standalone: true
})
export class NoticeTransitionDirective implements AfterViewInit, OnDestroy {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private enterFrame: number | null = null;
  private enterCleanupTimer: number | null = null;
  private enterCleanup: (() => void) | null = null;

  ngAfterViewInit(): void {
    const element = this.elementRef.nativeElement;
    if (this.shouldSkipAnimation(element)) {
      return;
    }

    this.animateEnter(element);
  }

  ngOnDestroy(): void {
    const element = this.elementRef.nativeElement;
    this.cancelEnterAnimation();

    if (this.shouldSkipAnimation(element)) {
      return;
    }

    this.animateLeaveClone(element);
  }

  private animateEnter(element: HTMLElement): void {
    const computedStyle = getComputedStyle(element);
    const height = element.getBoundingClientRect().height;
    if (height <= 0) {
      return;
    }

    const originalStyles = {
      height: element.style.height,
      marginBlockStart: element.style.marginBlockStart,
      marginBlockEnd: element.style.marginBlockEnd,
      opacity: element.style.opacity,
      overflow: element.style.overflow,
      transition: element.style.transition,
      willChange: element.style.willChange
    };
    const finalMarginBlockStart = computedStyle.marginBlockStart;
    const finalMarginBlockEnd = computedStyle.marginBlockEnd;

    element.style.height = '0px';
    element.style.marginBlockStart = '0px';
    element.style.marginBlockEnd = '0px';
    element.style.opacity = '0';
    element.style.overflow = 'hidden';
    element.style.transition = 'none';
    element.style.willChange = 'height, margin, opacity';

    const finish = (): void => {
      if (this.enterCleanupTimer !== null) {
        window.clearTimeout(this.enterCleanupTimer);
        this.enterCleanupTimer = null;
      }
      element.removeEventListener('transitionend', handleTransitionEnd);
      this.enterCleanup = null;

      if (!element.isConnected) {
        return;
      }

      element.style.height = originalStyles.height;
      element.style.marginBlockStart = originalStyles.marginBlockStart;
      element.style.marginBlockEnd = originalStyles.marginBlockEnd;
      element.style.opacity = originalStyles.opacity;
      element.style.overflow = originalStyles.overflow;
      element.style.transition = originalStyles.transition;
      element.style.willChange = originalStyles.willChange;
    };

    const handleTransitionEnd = (event: TransitionEvent): void => {
      if (event.target === element && event.propertyName === 'height') {
        finish();
      }
    };

    this.enterCleanup = finish;
    this.enterFrame = window.requestAnimationFrame(() => {
      this.enterFrame = null;
      if (!element.isConnected) {
        finish();
        return;
      }

      element.addEventListener('transitionend', handleTransitionEnd);
      element.style.transition = NOTICE_TRANSITION_STYLE;
      element.style.height = `${height}px`;
      element.style.marginBlockStart = finalMarginBlockStart;
      element.style.marginBlockEnd = finalMarginBlockEnd;
      element.style.opacity = '1';
      this.enterCleanupTimer = window.setTimeout(finish, NOTICE_TRANSITION_MS + 120);
    });
  }

  private animateLeaveClone(element: HTMLElement): void {
    const parent = element.parentNode;
    if (!parent) {
      return;
    }

    const height = element.getBoundingClientRect().height;
    if (height <= 0) {
      return;
    }

    const computedStyle = getComputedStyle(element);
    const clone = element.cloneNode(true) as HTMLElement;
    clone.classList.add(NOTICE_TRANSITION_CLASS);
    clone.setAttribute('aria-hidden', 'true');
    clone.style.height = `${height}px`;
    clone.style.marginBlockStart = computedStyle.marginBlockStart;
    clone.style.marginBlockEnd = computedStyle.marginBlockEnd;
    clone.style.opacity = computedStyle.opacity || '1';
    clone.style.overflow = 'hidden';
    clone.style.pointerEvents = 'none';
    clone.style.transition = 'none';
    clone.style.willChange = 'height, margin, opacity';

    parent.insertBefore(clone, element.nextSibling);

    const removeClone = (): void => {
      clone.removeEventListener('transitionend', handleTransitionEnd);
      clone.remove();
    };

    const handleTransitionEnd = (event: TransitionEvent): void => {
      if (event.target === clone && event.propertyName === 'height') {
        removeClone();
      }
    };

    window.requestAnimationFrame(() => {
      if (!clone.isConnected) {
        return;
      }

      clone.addEventListener('transitionend', handleTransitionEnd);
      clone.style.transition = NOTICE_TRANSITION_STYLE;
      clone.style.height = '0px';
      clone.style.marginBlockStart = '0px';
      clone.style.marginBlockEnd = '0px';
      clone.style.opacity = '0';
      window.setTimeout(removeClone, NOTICE_TRANSITION_MS + 120);
    });
  }

  private cancelEnterAnimation(): void {
    if (this.enterFrame !== null) {
      window.cancelAnimationFrame(this.enterFrame);
      this.enterFrame = null;
    }

    if (this.enterCleanupTimer !== null) {
      window.clearTimeout(this.enterCleanupTimer);
      this.enterCleanupTimer = null;
    }

    this.enterCleanup?.();
    this.enterCleanup = null;
  }

  private shouldSkipAnimation(element: HTMLElement): boolean {
    return typeof window === 'undefined'
      || element.classList.contains(NOTICE_TRANSITION_CLASS)
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
