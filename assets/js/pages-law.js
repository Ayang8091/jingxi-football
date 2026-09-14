/* ==========================================================================
   竞析 JINGXI · 合规与数据源页 + 站点启动
   ========================================================================== */
(function (global) {
  'use strict';

  var D = global.JX_DATA, U = global.JX.U, mg = global.JX.mg;

  function renderCompliance() {
    var host = U.byId('law-body');

    var bounds = [
      ['不销售彩票', '本站不是彩票销售平台，没有任何购彩入口、订单、支付或兑奖功能。'],
      ['不代购 / 不代兑奖', '本站不代任何人购买彩票，也不代为兑奖、不接触任何购彩资金。'],
      ['不提供私彩与境外博彩', '本站不介绍、不引导、不链接任何非法私彩、赌博网站或境外博彩平台。'],
      ['不承诺结果', '本站输出的全部内容为统计分析与概率研究，不构成投注建议，不承诺任何命中或收益。'],
      ['不收费荐彩', '本站不提供任何形式的付费荐彩、会员包月、跟单分成或返佣服务。'],
      ['不诱导追加投入', '模型允许"今天不推荐"。本站从不通过放大收益预期来促使扩大投入。']
    ];

    var law = [
      ['体育彩票的法定属性', '中国体育彩票（含竞彩足球）经国务院批准，由国家体育总局体育彩票管理中心统一发行销售，属国家特许的公益彩票，其收入按规定比例纳入公益金。请仅在具备合法资质的销售网点购买。'],
      ['非法博彩的法律后果', '参与或组织非法赌博、网络私彩、境外博彩，涉嫌违反《中华人民共和国治安管理处罚法》《中华人民共和国刑法》相关规定。本站坚决反对并拒绝为此类活动提供任何协助。'],
      ['未成年人保护', '《彩票管理条例》明确禁止向未成年人销售彩票和兑奖。本站内容面向成年读者，明确禁止未满 18 周岁人士购彩。'],
      ['数据分析内容的定位', '本站内容属于公开数据的统计建模与概率研究，性质等同于体育数据研究或赛事评论，不针对任何具体投注行为提供指令性建议。读者应独立判断并对自身行为负责。'],
      ['信息来源合规', '本站仅使用公开可得的赛事、赔率与统计数据，不采集、不使用任何内部信息或非公开信息。']
    ];

    var data = D.meta;

    host.innerHTML =
      '<div class="callout c-warn mb16"><h4>先读这一段</h4>' +
        '<p class="mb0">本站是一个<b>足球数据统计与概率研究项目</b>，不是荐彩平台、不是博彩网站、不是彩票销售渠道。' +
        '所有内容的目标是：把公开数据整理清楚、把概率算得可验证、把战绩公示得完整。' +
        '如果你在寻找"稳赚方案"或"内部消息"，本站并不提供，也不会提供。</p></div>' +

      '<div class="card"><div class="card-h"><h2>一、服务边界（我们做什么，不做什么）</h2></div>' +
        '<div class="card-b"><div class="grid-2">' +
          bounds.map(function (b) {
            return '<div class="callout" style="border-left-color:var(--lose)"><h4>' + U.esc(b[0]) + '</h4>' +
              '<p class="small mb0">' + U.esc(b[1]) + '</p></div>';
          }).join('') +
        '</div></div></div>' +

      '<div class="card"><div class="card-h"><h2>二、理性购彩与风险自担</h2>' +
        '<span class="tag t-warn">重要</span></div>' +
        '<div class="card-b">' +
          '<div class="grid-2">' +
            '<div><div class="small" style="font-weight:700;margin-bottom:8px">概率常识</div>' +
              '<ul class="small">' +
                '<li>一个 65% 概率的事件，在三次里就可能有一次不发生。这不是模型失效，这是概率本身。</li>' +
                '<li>本站公示的最大连续亏损为 ' + D.records.kpi.maxLose + ' 注，最大回撤 ' + D.records.kpi.maxDrawdown + ' 单位。这类回撤在任何正期望体系中都必然出现。</li>' +
                '<li>历史表现不代表未来收益。模型会随市场效率提升而衰减，因此需要持续重训。</li>' +
                '<li>单场比赛的结果受大量不可建模因素影响，任何分析都无法消除其随机性。</li>' +
              '</ul></div>' +
            '<div><div class="small" style="font-weight:700;margin-bottom:8px">行为准则</div>' +
              '<ul class="small">' +
                '<li>只用可自由支配的闲余资金参与，绝不借贷购彩。</li>' +
                '<li>设定明确的投入上限并严格执行，不因连续亏损而追加。</li>' +
                '<li>不把购彩当作收入来源或翻本手段。</li>' +
                '<li>如果购彩影响情绪、睡眠、工作或家庭关系，请立即停止并寻求专业帮助。</li>' +
              '</ul></div>' +
          '</div>' +
          '<div class="callout c-warn mt16"><h4>如果你或身边的人出现失控购彩行为</h4>' +
            '<p class="mb0">请及时与家人沟通，或向正规心理健康服务机构求助。赌博障碍是可以被专业干预的行为问题。' +
            '任何"最后一次就能回本"的想法，都是问题的一部分，而不是解决方案。</p></div>' +
        '</div></div>' +

      '<div class="card" id="data"><div class="card-h"><h2>三、数据来源与更新机制</h2>' +
        '<span class="tiny muted">这一节决定了本站是否可持续</span></div>' +
        '<div class="card-b flush"><table class="tbl"><thead><tr>' +
          '<th>数据源</th><th>字段</th><th>更新频率</th></tr></thead><tbody>' +
          data.sources.map(function (s) {
            return '<tr><td><b>' + U.esc(s.name) + '</b></td><td class="small">' + U.esc(s.item) + '</td>' +
              '<td><span class="tag t-brand">' + U.esc(s.freq) + '</span></td></tr>';
          }).join('') +
        '</tbody></table></div>' +
        '<div class="card-b">' +
          '<div class="mini-grid mb16">' +
            mg('全量刷新', '每日 09:00') +
            mg('增量刷新', '赛前 90 / 30 / 10 分钟') +
            mg('模型重训', '每 30 天') +
            mg('数据时区', data.timezone) +
            mg('赛季', data.season) +
            mg('数据当前状态', '演示样本 (DEMO)') +
          '</div>' +
          '<div class="grid-2">' +
            '<div class="callout"><h4>更新机制</h4><p class="small mb0">' + U.esc(data.refreshNote) +
              '。每个采集任务写入时留存版本快照（含时间戳与校验和），推荐在开赛前锁定后不再变动。</p></div>' +
            '<div class="callout"><h4>为什么"可持续"等于"可复现"</h4><p class="small mb0">' +
              '一个预测站点能否长期运营，不取决于它今天说了什么，而取决于它昨天的说法能不能被验证。' +
              '因此本站把"数据快照 + 推荐锁定 + 自动结算 + 全量公示"作为架构级要求，而不是运营态度问题。</p></div>' +
          '</div>' +
          '<div class="callout c-gold mt16"><h4>当前演示状态说明</h4>' +
            '<p class="mb0">本页展示的赛事、赔率、战绩均为<b>演示样本数据</b>，用于验证产品结构、模型计算逻辑与交互流程，' +
            '<b>不对应任何真实开售赛事，不可用于实际投注决策</b>。接入官方数据源后，同一套渲染与结算逻辑会自动生效，' +
            '届时所有指标将来自真实数据并可被逐条核对。</p></div>' +
        '</div></div>' +

      '<div class="card"><div class="card-h"><h2>四、法律与监管说明</h2></div>' +
        '<div class="card-b"><div class="flow">' +
          law.map(function (l) {
            return '<div class="flow-step"><div class="fs-n" style="background:var(--brand-2)">§</div>' +
              '<div class="fs-t">' + U.esc(l[0]) + '</div><div class="fs-d">' + U.esc(l[1]) + '</div></div>';
          }).join('') +
        '</div></div></div>' +

      '<div class="card"><div class="card-h"><h2>五、免责声明</h2></div>' +
        '<div class="card-b">' +
          '<p class="small">1. 本站提供的全部内容（包括但不限于模型概率、推荐选项、仓位建议、赔率异动分析、战绩统计）均基于公开历史数据与统计模型生成，' +
          '<b>属于概率研究范畴，不构成任何形式的投注建议、投资建议或收益承诺</b>。</p>' +
          '<p class="small">2. 读者依据本站内容做出的任何决策，其后果由读者自行承担。本站不对任何形式的直接或间接损失承担责任。</p>' +
          '<p class="small">3. 概率不等于事实。模型输出的百分比是长期统计期望，任何单场结果都可能与该期望不符。</p>' +
          '<p class="small">4. 历史表现不代表未来收益。模型参数会随数据更新而调整，过去的校准水平不代表未来维持同一水平。</p>' +
          '<p class="small">5. 本站可能包含指向第三方数据源或法规原文的链接，该类链接仅为信息完整性服务，本站不对第三方内容负责。</p>' +
          '<p class="small mb0">6. 未成年人禁止在任何渠道购买彩票。若你未满 18 周岁，请立即离开本站。</p>' +
        '</div></div>' +

      '<div class="card"><div class="card-h"><h2>六、纠错与反馈</h2></div>' +
        '<div class="card-b">' +
          '<div class="grid-2">' +
            '<div class="callout"><h4>发现数据错误？</h4><p class="small mb0">' +
              '如果你发现某场比赛的赔率、比分、战绩或计算结果有误，请指出具体场次编号与字段。' +
              '数据错误是严肃问题——本站在核实后会修正数据源，并在战绩公示中标注修正记录，而不是静默覆盖。</p></div>' +
            '<div class="callout"><h4>对方法有异议？</h4><p class="small mb0">' +
              '模型的全部参数、公式与阈值都已公开在<a href="model.html">模型与方法</a>页。' +
              '欢迎指出方法上的问题。一个不接受质疑的模型，通常也没有在解决问题。</p></div>' +
          '</div>' +
          '<div class="callout c-win mt16"><h4>本站的自我约束</h4>' +
            '<p class="mb0">我们不删除负回报月份，不隐藏连黑记录，不因为某条推荐失败而修改它的原始内容。' +
            '如果有一天本站开始只展示好消息，那它就已经不再是数据分析，请停止使用它。</p></div>' +
        '</div></div>';
  }

  global.JX.renderCompliance = renderCompliance;
})(window);
