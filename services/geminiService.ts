
import { GoogleGenAI, Type, Chat } from "@google/genai";
import { Topic, QuizQuestion } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_FAST = "gemini-2.5-flash";
const MODEL_SMART = "gemini-2.5-flash"; 

export const generateDailyTopics = async (day: number): Promise<Topic[]> => {
  try {
    const prompt = `为第 ${day} 天的学习计划生成 10 个 Unity 游戏开发面试知识点（使用简体中文）。
      
    要求：
    1. **难度循序渐进**：前 3 个为基础概念，中间 4 个为进阶应用，最后 3 个为底层原理或复杂场景。
    2. **内容配比**：
       - 50% Unity 引擎 (生命周期, 物理, 渲染管线, UI, ECS 等)
       - 30% C# 语言特性 (内存管理, GC, 委托/事件, 多线程, LINQ 等)
       - 20% 计算机网络基础 (TCP/UDP, HTTP, Socket, 状态同步/帧同步)
    3. **代码示例**：提供理论解释和实用的代码示例。代码必须包含换行符。

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
              title: { type: Type.STRING, description: "知识点标题 (中文)" },
              category: { type: Type.STRING, enum: ["Unity", "C#", "Network"], description: "分类" },
              concept: { type: Type.STRING, description: "简明扼要的解释 (2-3句话，中文)" },
              exampleCode: { type: Type.STRING, description: "C# 代码片段 (必须包含换行符 \\n 以便竖向显示)" },
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
    console.error("Error generating topics:", error);
    return [];
  }
};

export const generateQuiz = async (topics: Topic[]): Promise<QuizQuestion[]> => {
  const topicsContext = JSON.stringify(topics);
  
  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: `基于以下 Unity/C#/网络 知识点创建 20 道面试题（使用简体中文）：
      ${topicsContext}
      
      要求：
      1. **代码格式化**：如果题目包含代码，必须在 JSON 字符串中使用 \\n 换行，确保代码可读性高，不要写成一行。
      2. **题型多样**：
         - 普通单选 (概念记忆)
         - 代码分析 (给出一段格式良好的多行代码，问输出或Bug)
         - 判断题 (True/False)
         - 场景设计 (Best Practice)
      3. **解析**：详细解释正确选项和错误选项的原因。`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING, description: "问题描述，支持 Markdown 格式的代码块" },
              options: { type: Type.ARRAY, items: { type: Type.STRING }, description: "选项数组 (中文)" },
              correctIndex: { type: Type.INTEGER, description: "正确答案的索引 (0-3)" },
              explanation: { type: Type.STRING, description: "详细解析 (中文)" },
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
    console.error("Error generating quiz:", error);
    return [];
  }
};

// Updated Comprehensive Exam to accept mistakes and dynamic count
export const generateComprehensiveQuiz = async (
  topicsSummary: string[], 
  previousMistakes: string[],
  questionCount: number
): Promise<QuizQuestion[]> => {
  try {
    // Cap question count to avoid timeouts (e.g., max 50)
    const safeCount = Math.min(questionCount, 50);
    
    const topicsStr = topicsSummary.join(", ");
    const mistakesStr = previousMistakes.length > 0 
      ? `重点考察用户之前的错题领域：${previousMistakes.slice(0, 10).join("; ")}...` 
      : "无历史错题，请全面考察。";

    const prompt = `生成一份包含 ${safeCount} 道题目的 Unity 综合面试试卷（简体中文）。
    
    考察范围：${topicsStr}
    
    **特别要求**：
    1. ${mistakesStr} (请针对这些薄弱环节出变种题或加深题)。
    2. **题目中的代码必须格式良好**：使用 \\n 进行换行，禁止单行代码。
    3. 包含至少 20% 的架构设计或底层原理题。
    4. 包含至少 30% 的代码阅读题。
    
    返回 JSON 格式。`;

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
  const topicsJson = JSON.stringify(topics);
  
  try {
    const response = await ai.models.generateContent({
      model: MODEL_SMART,
      contents: `我刚刚学习了这些知识点 (Unity/C#/Network)：${topicsJson}。
      测验得分 ${quizScore}。
      请生成一份详细的 Markdown 学习笔记（简体中文）。
      
      格式要求：
      1. 使用清晰的标题。
      2. **代码示例必须竖向排列**，使用多行代码块，不要压缩成一行。
      3. 包含 "面试官常问" 部分。
      4. 包含 C# 底层原理和网络同步机制的深入解释。
      5. 针对测试中可能遇到的难点（如代码陷阱）进行额外提示。`,
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
