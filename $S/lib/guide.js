"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GUIDE_INTRO = void 0;
exports.guideFor = guideFor;
const guideContent_1 = require("./guideContent");
/** The tab sections, shortened for one card each. */
function guideFor(v) {
    return (0, guideContent_1.tabsFor)(v).map((s) => ({
        tab: s.title,
        summary: s.summary,
        points: s.points.slice(0, guideContent_1.TOUR_POINTS),
    }));
}
/** One line under the title on the tour. The guide screen has its own, because
 *  it shows more than the tabs and would be describing itself wrongly. */
exports.GUIDE_INTRO = guideContent_1.TOUR_INTRO;
