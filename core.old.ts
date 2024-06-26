import DOMPurify from "isomorphic-dompurify";
import { fetchWikiPage, parseWikiProblem, renderKatexString, estimateDifficulty, parseTitle, fetchProblemAnswer } from "aesthete";
import problemCache from "./problemPages.json" assert { type: "json" };

function randomArray(array: any) {
    for (let i = array.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        let temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
}

const generateProblems = async ({ contestSelection, contestData }: { contestSelection: any; contestData: any; }) => {
    let generatedProblems: any = [];
    let problemDetails: any = [];

    contestSelection as any;
    contestData as any;

    Object.entries(contestSelection).forEach(([contest, selected], i) => {
        if (!selected) {
            return;
        }
        const details = contestData[contest];
        let contestProblems = problemCache[contest as 'amc8' | 'amc10' | 'amc12' | 'aime'].slice(0);

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

    const fetchProblem = async (problem: string, i: number) => {
        const { answerType, contest } = problemDetails[i];
        const { year, contestName, problemIndex } = parseTitle(contest, problem) as { year: string; contestName: string; problemIndex: string };

        const [wikiProblem, answer] = await Promise.allSettled([parseWikiProblem(problem), fetchProblemAnswer(Number(year), contestName, Number(problemIndex))]);

        if (wikiProblem?.status != "fulfilled" || !wikiProblem?.value?.problem) {
            console.error(
                "ERROR: " + problem + " PROBLEM failed to resolve"
            );
            return null;
        }

        if (answer?.status != "fulfilled" || !answer?.value) {
            console.error(
                "ERROR: " + problem + " ANSWER failed to resolve"
            );
            return null;
        }

        let ans: any = answer.value;

        if (answerType == "aime"){
            if (Array.isArray(answer.value)){
                ans = answer.value.map(value => {
                    return parseInt(value);
                })
            } else {
                ans = parseInt(answer.value);
            }
        }

        return {
            ...wikiProblem.value,
            answer: ans,
            difficulty: estimateDifficulty(contest, Number(year), Number(problemIndex)),
            metadata: {
                year,
                contestName,
                problemIndex
            },
            contest,
            answerType
        }
    };

    const problems = await Promise.allSettled(
        generatedProblems.map((problem: string, i: number) => {
            return fetchProblem(problem, i);
        })
    );


    return problems.map((problem, i) => {
        if (problem?.status != "fulfilled" || !problem?.value?.problem) {
            console.error(
                "ERROR: " + generatedProblems[i] + " failed to resolve"
            );
            return null;
        }

        const { status, value } = problem;
        const { year, contestName, problemIndex } = value.metadata;

        return {
            ...value,
            problemTitle: `${year} ${contestName} #${problemIndex}`,
            problem: DOMPurify.sanitize(renderKatexString(value.problem), {
                FORBID_TAGS: ["a"],
            }),
        };
    });
};

export { generateProblems };
