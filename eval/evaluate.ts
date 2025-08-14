import 'dotenv/config';
import fs from 'fs';
import path from 'path';

interface TestQuestion {
  id: number;
  question: string;
  category: string;
  expectedSources: string[];
  requiresLiveData: boolean;
  expectedTopics: string[];
  difficulty: string;
}

interface EvaluationResult {
  questionId: number;
  question: string;
  answer: string;
  sources: string[];
  citations: { [key: number]: string };
  responseTime: number;
  hasCitations: boolean;
  hasExpectedSources: boolean;
  liveDataUsed: boolean;
  success: boolean;
}

async function callChatAPI(query: string): Promise<any> {
  const apiUrl = process.env.API_BASE_URL || 'http://localhost:3000';
  
  try {
    const response = await fetch(`${apiUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`API call failed for query: "${query}"`, error);
    return {
      error: 'API call failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      responseTime: 0,
    };
  }
}

async function runEvaluation() {
  console.log('🧪 Starting XO Market Chatbot Evaluation...\n');

  const testQuestionsPath = path.join(__dirname, 'test-questions.json');
  
  if (!fs.existsSync(testQuestionsPath)) {
    console.error('❌ test-questions.json not found in eval/ directory');
    process.exit(1);
  }

  const testData = JSON.parse(fs.readFileSync(testQuestionsPath, 'utf-8'));
  const questions: TestQuestion[] = testData.testQuestions || testData.questions || [];

  if (questions.length === 0) {
    console.error('❌ No test questions found in the file');
    process.exit(1);
  }

  console.log(`📋 Running evaluation on ${questions.length} questions...\n`);

  const results: EvaluationResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    console.log(`\n🔍 Question ${question.id}/${questions.length}: ${question.question}`);
    
    const questionStartTime = Date.now();
    const response = await callChatAPI(question.question);
    const responseTime = Date.now() - questionStartTime;

    let result: EvaluationResult;

    if (response.error) {
      console.log(`❌ Failed: ${response.details}`);
      result = {
        questionId: question.id,
        question: question.question,
        answer: '',
        sources: [],
        citations: {},
        responseTime,
        hasCitations: false,
        hasExpectedSources: false,
        liveDataUsed: false,
        success: false,
      };
    } else {
      const hasCitations = Object.keys(response.citations || {}).length > 0;
      const hasExpectedSources = question.expectedSources.length === 0 || 
        question.expectedSources.some((expected: string) => 
          (response.sources || []).some((source: string) => source.includes(expected))
        );
      const liveDataUsed = !!response.liveData;

      result = {
        questionId: question.id,
        question: question.question,
        answer: response.answer || '',
        sources: response.sources || [],
        citations: response.citations || {},
        responseTime,
        hasCitations,
        hasExpectedSources,
        liveDataUsed,
        success: true,
      };

      console.log(`✅ Success: ${responseTime}ms`);
      console.log(`📚 Sources: ${result.sources.length > 0 ? result.sources.join(', ') : 'None'}`);
      console.log(`🔗 Citations: ${hasCitations ? '✅' : '❌'}`);
      
      if (question.requiresLiveData) {
        console.log(`📊 Live Data: ${liveDataUsed ? '✅' : '❌'}`);
      }
    }

    results.push(result);
    
    if (i < questions.length - 1) {
      console.log('⏳ Waiting 2 seconds...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const totalTime = Date.now() - startTime;

  const report = generateReport(results, totalTime);
  
  fs.writeFileSync(path.join(__dirname, 'results.md'), report);
  
  console.log('\n📊 Evaluation Complete!');
  console.log(`📄 Results saved to eval/results.md`);
  console.log(`⏱️  Total evaluation time: ${(totalTime / 1000).toFixed(1)}s`);
}

function generateReport(results: EvaluationResult[], totalTime: number): string {
  const totalQuestions = results.length;
  const successfulQuestions = results.filter(r => r.success).length;
  const questionsWithCitations = results.filter(r => r.hasCitations).length;
  const questionsWithExpectedSources = results.filter(r => r.hasExpectedSources).length;
  const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / totalQuestions;

  let report = `# XO Market Chatbot Evaluation Results\n\n`;
  report += `**Date:** ${new Date().toISOString()}\n`;
  report += `**Total Questions:** ${totalQuestions}\n`;
  report += `**Evaluation Duration:** ${(totalTime / 1000).toFixed(1)} seconds\n\n`;
  
  report += `## Summary Metrics\n\n`;
  report += `| Metric | Value | Percentage |\n`;
  report += `|--------|-------|------------|\n`;
  report += `| Successful Responses | ${successfulQuestions} | ${(successfulQuestions/totalQuestions*100).toFixed(1)}% |\n`;
  report += `| Questions with Citations | ${questionsWithCitations} | ${(questionsWithCitations/totalQuestions*100).toFixed(1)}% |\n`;
  report += `| Questions with Expected Sources | ${questionsWithExpectedSources} | ${(questionsWithExpectedSources/totalQuestions*100).toFixed(1)}% |\n`;
  report += `| Average Response Time | ${avgResponseTime.toFixed(0)}ms | - |\n\n`;

  const categories = [...new Set(results.map(r => {
    const question = results.find(res => res.questionId === r.questionId);
    return 'general'; // Default category since we don't have category info in results
  }))];

  report += `## Performance by Question\n\n`;
  
  for (const result of results) {
    report += `### Question ${result.questionId}\n\n`;
    report += `**Q:** ${result.question}\n\n`;
    
    if (result.success) {
      const truncatedAnswer = result.answer.length > 200 
        ? result.answer.substring(0, 200) + '...' 
        : result.answer;
      report += `**A:** ${truncatedAnswer}\n\n`;
      report += `**Sources:** ${result.sources.join(', ') || 'None'}\n\n`;
      report += `**Citations:** ${result.hasCitations ? '✅' : '❌'}\n\n`;
      report += `**Response Time:** ${result.responseTime}ms\n\n`;
    } else {
      report += `**Status:** ❌ Failed\n\n`;
      report += `**Response Time:** ${result.responseTime}ms\n\n`;
    }
    
    report += `---\n\n`;
  }

  const overallScore = (successfulQuestions / totalQuestions) * 100;
  report += `## Overall Assessment\n\n`;
  
  if (overallScore >= 90) {
    report += `**Grade: A (${overallScore.toFixed(1)}%)** - Excellent performance! 🎉\n\n`;
  } else if (overallScore >= 80) {
    report += `**Grade: B (${overallScore.toFixed(1)}%)** - Good performance with room for improvement. ✅\n\n`;
  } else if (overallScore >= 70) {
    report += `**Grade: C (${overallScore.toFixed(1)}%)** - Adequate performance, needs optimization. ⚠️\n\n`;
  } else {
    report += `**Grade: D (${overallScore.toFixed(1)}%)** - Below expectations, requires attention. ❌\n\n`;
  }

  report += `### Key Findings\n\n`;
  report += `- **Response Success Rate:** ${(successfulQuestions/totalQuestions*100).toFixed(1)}%\n`;
  report += `- **Citation Accuracy:** ${(questionsWithCitations/totalQuestions*100).toFixed(1)}%\n`;
  report += `- **Source Relevance:** ${(questionsWithExpectedSources/totalQuestions*100).toFixed(1)}%\n`;
  report += `- **Average Response Time:** ${avgResponseTime.toFixed(0)}ms\n\n`;

  report += `### Recommendations\n\n`;
  if (successfulQuestions < totalQuestions) {
    report += `- Address API failures and rate limiting issues\n`;
  }
  if (questionsWithCitations < successfulQuestions) {
    report += `- Improve citation generation and formatting\n`;
  }
  if (avgResponseTime > 5000) {
    report += `- Optimize response time for better user experience\n`;
  }
  report += `- Continue monitoring and improving based on user feedback\n\n`;

  return report;
}

if (require.main === module) {
  runEvaluation().catch(console.error);
}

export { runEvaluation };
