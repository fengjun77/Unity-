
import { GoogleGenAI, Type, Chat } from "@google/genai";
import { Topic, QuizQuestion } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_FAST = "gemini-2.5-flash";
const MODEL_SMART = "gemini-2.5-flash"; 

/**
 * Generates a batch of topics.
 * @param day The current day number.
 * @param startIndex The starting index for the topics (e.g., 1 for the first topic).
 * @param count How many topics to generate in this batch.
 */
export const generateTopicBatch = async (day: number, startIndex: number, count: number): Promise<Topic[]> => {
  try {
    const prompt = `为第 ${day} 天的学习计划生成 ${count} 个 Unity 游戏开发面试知识点。
    从第 ${startIndex} 个知识点开始 (序号 ${startIndex} - ${startIndex + count - 1})。
      
    要求：
    1. **内容详尽**：不要简化！必须包含该知识点的全部重要内容、底层原理。
    2. **面试八股文**：在 concept 中必须包含 "### 面试必问" 章节，列出 2-3 个相关面试题（含答案），难度由浅入深。
    3. **难度分布**：
       - 如果序号 1-3：基础概念
       - 如果序号 4-7：进阶/实战
       - 如果序号 8-10：底层架构/源码分析
    4. **代码示例**：代码必须详细，关键部分要有注释，使用 \\n 换行。

    请确保 JSON 返回格式正确。`;

    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "标题" },
              category: { type: Type.STRING, enum: ["Unity", "C#", "Network"] },
              concept: { type: Type.STRING, description: "详细解释 + 面试八股文 (Markdown)" },
              exampleCode: { type: Type.STRING, description: "完整代码片段 (带\\n)" },
              difficulty: { type: Type.STRING, enum: ["初级", "中级", "高级"] },
            },
            required: ["title", "concept", "difficulty", "category"],
          },
        },
      },
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text) as Topic[];
  } catch (error) {
    console.error("Error generating topic batch:", error);
    return [];
  }
};

/**
 * Generates quiz questions specifically for the provided list of topics.
 * Usually called in background after topics are loaded.
 */
export const generateQuizForBatch = async (topics: Topic[]): Promise<QuizQuestion[]> => {
  if (topics.length === 0) return [];
  const topicsContext = JSON.stringify(topics.map(t => ({ title: t.title, concept: t.concept.substring(0, 500) }))); // Trim concept to save tokens context
  
  try {
    const questionCount = topics.length * 2; // 2 questions per topic
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: `基于以下知识点创建 ${questionCount} 道面试题（简体中文）：
      ${topicsContext}
      
      要求：
      1. **题量**：每个知识点对应 2 道题。
      2. **代码格式**：JSON 字符串中必须用 \\n 换行。
      3. **题型**：单选或代码输出预测。
      4. **解析**：解释要精辟，指出坑点。`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING, description: "问题 (支持 Markdown 代码块)" },
              options: { type: Type.ARRAY, items: { type: Type.STRING }, description: "4个选项" },
              correctIndex: { type: Type.INTEGER, description: "0-3" },
              explanation: { type: Type.STRING, description: "解析" },
            },
            required: ["question", "options", "correctIndex", "explanation"],
          },
        },
      },
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text) as QuizQuestion[];
  } catch (error) {
    console.error("Error generating quiz batch:", error);
    return [];
  }
};

// Kept for compatibility if needed, but App.tsx will mostly use generateTopicBatch
export const generateDailyTopics = async (day: number): Promise<Topic[]> => {
  return generateTopicBatch(day, 1, 10);
};

// Kept for compatibility
export const generateQuiz = async (topics: Topic[]): Promise<QuizQuestion[]> => {
  return generateQuizForBatch(topics);
};

export const generateComprehensiveQuiz = async (
  topicsSummary: string[], 
  previousMistakes: string[],
  questionCount: number
): Promise<QuizQuestion[]> => {
  try {
    const safeCount = Math.min(questionCount, 50);
    
    const topicsStr = topicsSummary.join(", ");
    const mistakesStr = previousMistakes.length > 0 
      ? `重点考察错题领域：${previousMistakes.slice(0, 10).join("; ")}...` 
      : "全面考察。";

    const prompt = `生成 ${safeCount} 道 Unity 综合面试题。
    
    范围：${topicsStr}
    要求：
    1. ${mistakesStr}
    2. **代码格式**：使用 \\n 换行。
    3. 20% 底层原理，30% 代码阅读。
    
    返回 JSON。`;

    const response = await ai.models.generateContent({
      model: MODEL_SMART, 
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctIndex: { type: Type.INTEGER },
              explanation: { type: Type.STRING },
            },
            required: ["question", "options", "correctIndex", "explanation"],
          },
        },
      },
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text) as QuizQuestion[];
  } catch (error) {
    console.error("Error generating comprehensive quiz:", error);
    return [];
  }
};

export const generateStudyNotes = async (topics: Topic[], quizScore: number): Promise<string> => {
  const topicsJson = JSON.stringify(topics.map(t => ({ title: t.title, concept: t.concept.substring(0, 1000) })));
  
  try {
    const response = await ai.models.generateContent({
      model: MODEL_SMART,
      contents: `学习内容：${topicsJson}。
      得分 ${quizScore}。
      生成 Markdown 学习笔记（简体中文）。
      
      要求：
      1. 结构清晰，标题明确。
      2. **代码块必须竖向排列**。
      3. 包含 "面试官常问" 和 "底层原理" 总结。`,
    });
    
    return response.text || "无法生成笔记。";
  } catch (error) {
    console.error("Error generating notes:", error);
    return "生成笔记时出错，请重试。";
  }
};

let chatSession: Chat | null = null;

export const startChatSession = () => {
  chatSession = ai.chats.create({
    model: MODEL_FAST,
    config: {
      systemInstruction: "你是一位资深 Unity 架构师。精通 C# 底层、渲染管线和网络同步。回答必须使用简体中文。代码示例必须多行显示。",
    },
  });
};

export const sendMessageToChat = async (message: string): Promise<string> => {
  if (!chatSession) startChatSession();
  try {
    const response = await chatSession!.sendMessage({ message });
    return response.text || "";
  } catch (error) {
    console.error("Chat error:", error);
    return "连接错误，请稍后再试。";
  }
};
