const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini with your key from .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const getSustainabilityReport = async (parcelData) => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    const prompt = `
        You are an AI Land Auditor for GDLR. 
        Analyze this spatial data: ${JSON.stringify(parcelData)}.
        Explain the sustainability potential of this location and 
        suggest if it's suitable for renewable energy expansion.
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
};

const predictTradeImpact = async (sourceId, targetId, amount, type) => {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = `
            You are an AI environmental economist for a Green Digital Land Registry.
            Predict the micro-environmental and grid impact of trading ${amount} ${type} from parcel ${sourceId} to parcel ${targetId}.
            Keep the response to 2 sentences max. Emphasize sustainability, load balancing, or conservation.
        `;
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (err) {
        console.error("Gemini API Error (Predict):", err.message);
        return "AI Prediction unavailable due to high network demand. Proceeding with standard ledger checks.";
    }
};

module.exports = { getSustainabilityReport, predictTradeImpact };