import DOMPurify from "isomorphic-dompurify";
import { fetchWikiPage, parseWikiProblem, parseKatex, estimateDifficulty, parseTitle } from "vo-core";
import problemCache from "./problemPages.json" assert { type: "json" };

function randomArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
}

const generateProblems = async ({ contestSelection, contestDetails }) => {
    let generatedProblems = [];
    let problemDetails = [];

    Object.entries(contestSelection).forEach(([contest, selected], i) => {
        if (!selected) {
            return;
        }
        const details = contestDetails[contest];
        let contestProblems = problemCache[contest].slice(0);

        randomArray(contestProblems);
        generatedProblems.push(contestProblems.slice(0, details.problemCount));

        for (let i = 0; i < details.problemCount; ++i){
            problemDetails.push({
                contest,
                answerType: contest == "aime" ? "aime":"amc"
            })
        }
    });

    generatedProblems = generatedProblems.flat();

    const problems = await Promise.allSettled(
        generatedProblems.map((problem) => parseWikiProblem(problem))
    );

    return problems.map(({ status, value }, i) => {
        if (status != "fulfilled" || !value?.problem) {
            console.error(
                "ERROR: " + generatedProblems[i] + " failed to resolve"
            );
            return null;
        }

        const { answerType, contest } = problemDetails[i];
        const { year, contestName, problemIndex } = parseTitle(contest, generatedProblems[i]);

        return {
            ...value,
            difficulty: estimateDifficulty(contest, year, problemIndex),
            problemTitle: `${year} ${contestName} #${problemIndex}`,
            answerType,
            problem: DOMPurify.sanitize(parseKatex(value.problem), {
                FORBID_TAGS: ["a"],
            }),
        };
    });
};

export { generateProblems };
