// The first-run tour's sections, derived from the guide's.
//
// This file used to hold the words themselves. It no longer does: they moved to
// src/lib/guideContent.ts when the guide grew sections that are not a tab — an
// injury from disclosure through to the control it withholds from a coach, a
// booking two people hold half of each, a package that charges again next
// month. The tour cannot show those. It is one card per tab with somebody
// standing between it and the app they just installed, and a walkthrough that
// opens with a release of liability is not a welcome.
//
// So the tour gets the TABS, trimmed to their first few points. Derived rather
// than written out a second time, because two hand-maintained lists are two
// things to keep true and the tour is the one nobody re-reads — which is
// exactly how it came to tell coaches they had five tabs while the bar had six.
//
// The export surface is unchanged so app/tour.tsx did not have to move with it.
import type { AppVariant } from './variant';
import { tabsFor, TOUR_INTRO, TOUR_POINTS } from './guideContent';

export interface GuideSection {
  /** Tab label as it appears in the bar, so the words match the screen. */
  tab: string;
  /** One line on what the tab is for. */
  summary: string;
  /** Concrete things you can do there. */
  points: string[];
}

/** The tab sections, shortened for one card each. */
export function guideFor(v: AppVariant): GuideSection[] {
  return tabsFor(v).map((s) => ({
    tab: s.title,
    summary: s.summary,
    points: s.points.slice(0, TOUR_POINTS),
  }));
}

/** One line under the title on the tour. The guide screen has its own, because
 *  it shows more than the tabs and would be describing itself wrongly. */
export const GUIDE_INTRO: Record<AppVariant, string> = TOUR_INTRO;
