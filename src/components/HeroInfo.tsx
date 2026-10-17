import { gsap } from "gsap";
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  useIsPresent,
} from "motion/react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import type { Translate } from "../i18n";
import { type Game, gameMeta } from "../library";
import { useReducedMotion } from "../services";

function Info({
  game,
  t,
  lang,
  recent,
}: {
  game: Game;
  t: Translate;
  lang: string;
  recent: number | undefined;
}) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (reduced || !element) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        element.children,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          duration: 0.28,
          stagger: 0.035,
          ease: "power3.out",
        },
      );
    }, ref);
    return () => context.revert();
  }, [reduced]);
  return (
    <m.div
      ref={ref}
      className="hero-info"
      inert={!present}
      aria-hidden={!present || undefined}
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0 : 0.18 }}
      exit={{
        opacity: reduced ? 1 : 0,
        transition: { duration: reduced ? 0 : 0.1 },
      }}
    >
      <span className="game-meta">
        {game.source === "xbox"
          ? "Xbox"
          : game.source === "custom"
            ? t("customApp")
            : game.source.toUpperCase()}{" "}
        · {t("installed")}
      </span>
      <h1>{game.title}</h1>
      <p>{gameMeta(game, t, lang, recent)}</p>
    </m.div>
  );
}

/** Only the information changes identity; the action buttons keep controller focus. */
export function HeroInfo({
  children,
  ...props
}: {
  game: Game;
  t: Translate;
  lang: string;
  recent: number | undefined;
  children: ReactNode;
}) {
  return (
    <section className="hero-copy" data-game-id={props.game.id}>
      <LazyMotion features={domAnimation} strict>
        <div className="hero-info-stack">
          <AnimatePresence initial={false}>
            <Info key={props.game.id} {...props} />
          </AnimatePresence>
        </div>
      </LazyMotion>
      {children}
    </section>
  );
}
