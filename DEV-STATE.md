# 寮€鍙戠姸鎬侊紙缁帴绗旇锛?
> dsh web 閲嶅惎鎴栦笂涓嬫枃鍘嬬缉涔嬪悗锛屽厛璇昏繖涓枃浠跺嵆鍙户缁伐浣溿€?
## 涓婁笅鏂囪嚜鍔ㄥ帇缂╋紙2026-09-17 璋冩暣锛?
**杩欐槸 dsh 鍐呯疆鑳藉姏锛屼笉鏄彃浠?*锛歚@deepseek-ai/dsh-base` 鐨?84 涓緷璧栭噷宸插惈
`dsh-compaction-basic`锛坱oken-meter 椹卞姩鐨勭瓥鐣?+ LLM 鎽樿鍚庣锛夈€乣dsh-compaction-tool-result-pruner`
锛堟棤闇€妯″瀷鐨?head/middle/tail 淇壀锛夈€乣dsh-spill-policy`/`dsh-spill-local`锛堣秴澶ц緭鍑虹Щ鍑轰笂涓嬫枃钀界洏锛夈€?`dsh-output-retention`銆乣dsh-token-meter`銆乣dsh-command-compact`锛堝嵆 `/compact` 鎵嬪姩瑙﹀彂锛夈€?
- **瑙﹀彂闃堝€?*锛歚DEFAULT_THRESHOLD_RATIO = .8` 鈫?涓婁笅鏂囩敤鍒?**80%** 鑷姩鍘嬬缉锛?  **鍘嬬缉鍚庡彧淇濈暀鏈€杩?16% 鍘熸枃**锛坄DEFAULT_RETAIN_RATIO = .16`锛夛紝鍏朵綑鐢辨ā鍨嬫€荤粨鎴愮粨鏋勫寲 checkpoint銆?- 鎽樿鎻愮ず璇嶈姹傦細preserve still-true facts銆乨rop stale ones銆佷繚浣忔枃浠惰矾寰?鍛戒护/閿欒涓?鏍囪瘑绗︺€?- **鍘熷鏃ュ織鏃犳崯钀界洏**锛歚~/.dsh/sessions/<宸ヤ綔鍖?/<sessionId>/session.v3.jsonl.zstd`锛堝帇缂╁悗浠嶅湪锛夈€?- 鍙厤缃瓧娈碉紙`dsh-compaction-basic` 鐨?Config锛夛細`thresholdRatio`銆乣retainRatio`銆乣retainTokens`銆?  `summarizationProvider`銆乣summarizationModel`銆乣maxTokens`銆乣compactionRetries`銆乣maxOverflowRetries`銆?  `modelPolicies`銆乣auto`锛?*缂虹渷鍗?true**锛屼笉鍐欎笉浼氬叧鎺夎嚜鍔ㄥ帇缂╋級銆?- **鏈満宸茶皟鏁翠负 0.7**锛堟洿鏃╄Е鍙戯紝鐣欐洿澶氫綑閲忥級锛氬啓鍦?`~/.dsh/profiles/web/cordis.patch.yml`銆?
### corpus patch 璇箟锛堣俯杩囩殑鍧戯紝鍔″繀璁颁綇锛?
`dsh-app-boot/lib/index.js` 鐨?`applyPatches` 瑙勫垯锛?
    const { id, insert, name, ...overrides } = patch;
    if (insert) { ...鏂板涓€琛?.. }                  // 瀵瑰凡瀛樺湪鐨?id 鐢?insert 鈫?"duplicate loader entry id" 鈫?鍚姩澶辫触
    const target = entryMap.get(id);                 // 涓嶅甫 insert = 鎸?id 瀹氫綅鏃㈡湁琛?    if (name && name !== target.name) { 璺宠繃骞惰鍛?}  // name 鍙敤浜庢牎楠?    for (const [k, v] of Object.entries(overrides)) target[k] = v   // 椤跺眰 key 鐩存帴瑕嗙洊

- **瑕嗙洊鏃㈡湁琛岋細涓嶈鍐?`insert:`**锛岀洿鎺?`- id: <琛宨d>` + `name:`锛堟牎楠岋級+ 椤跺眰 `config:`銆?- **`config` 鏄暣浣撴浛鎹紝涓嶆槸娣卞悎骞?* 鈫?瑕嗙洊鍓嶅厛纭鍘熻鏈夋病鏈?config锛涙湁灏卞緱鎶婂畬鏁撮厤缃妱涓€閬嶃€?- 琛?id 鍙栬嚜 `dsh-base` 鐨?patch锛堜緥濡?`compaction-basic`銆乣spill-policy`銆乣tool-result-pruner`锛夈€?- **楠岃瘉鏂规硶锛堝姟蹇呯収鍋氾級**锛氭敼瀹?patch 鍏堢敤**涓存椂绔彛璧蜂竴娆?*鍐嶉噸鍚敓浜р€斺€?  `node <rc2>/node_modules/@deepseek-ai/dsh/lib/bin.js web --port 0 --no-open`
  鍐欓敊浼氱珛鍒讳互 `duplicate loader entry id` 鎴?`entry not found` 鎷掑惎锛?*鐩存帴閲嶅惎鐢熶骇浼氳鏈嶅姟璧蜂笉鏉?*銆?
## 褰撳墠鐗堟湰

- 鐗堟湰 **0.4.1**锛堜粨搴?HEAD 瑙?`git log --oneline -1`锛夛綔 鍓嶄袱鐗?0.4.0锛堟寜闇€缈昏瘧锛? 0.3.0锛堟寚鏍囧叆鍙?`metrics.mjs`锛?- npm 涓婄殑 latest 鏄?**0.2.2**锛?.3.0 / 0.4.0 / 0.4.1 閮?*灏氭湭鍙戝竷**锛?- 宸插畨瑁呬负 profile link锛歚dsh plugin --profile web add link:C:/Users/20549/.dsh/plugins/dsh-auto-translate`
- 宸蹭笂绾块暅鍍忥細**https://gitee.com/nysjn/dsh-auto-translate.git**锛堣繙绔悕 `gitee`锛宍main` 璺熻釜 `gitee/main`锛?- 宸插彂甯?npm锛?*dsh-auto-translate@0.2.2**锛坙atest锛夛綔 0.2.0 / 0.2.1 涔熷湪绾夸笂
  - 鍒汉瀹夎锛歚dsh plugin --profile web add dsh-auto-translate`锛堟嬁鍒扮殑鏄?latest = 0.2.2锛?*娌℃湁鎸夐渶缈昏瘧涓庢閫夌炕璇?*锛?  - 鉁?**鏇存**锛?.2.1 褰撴椂骞堕潪銆屽彂甯冨け璐ャ€嶁€斺€擿npm publish` 鎵撳嵃鎴愬姛琛屽悗锛宺egistry 鐨?packument 涓?tarball
    **鍚屾鏈夊欢杩燂紙瀹炴祴绾?3~5 鍒嗛挓锛?*锛屾垜褰撴椂绔嬪埢鏌ヨ鎵嶇湅鍒?404銆傜幇鍦?0.2.1 鐨?tarball 宸插彲姝ｅ父涓嬭浇銆?    鏁欒锛?*鍒ゅ畾鍙戝竷鎴愬姛瑕佽疆璇㈠嚑鍒嗛挓**锛屽埆鐢ㄥ彂甯冨悗绔嬪埢鐨勭涓€娆℃煡璇笅缁撹锛涗篃涓嶈鍙湅 publish 鐨勮緭鍑恒€?    鎺掓煡鍔炴硶锛歚npm view <pkg> --json` 鐪?`time` 涓?`versions`锛屽啀 HEAD 涓€涓?    `https://registry.npmjs.org/<pkg>/-/<pkg>-<ver>.tgz`銆?  - 姣忔鍙戝竷鐨勪护鐗屾祦绋嬭涓嬮潰銆屽彂甯冨埌 npm銆嶄竴鑺傦紙涓存椂 bypass 浠ょ墝 鈫?鍙?鈫?绔嬪嵆鍒犻櫎 鈫?鍥?npm 鍚婇攢锛?- 鐢熸晥鏂瑰紡锛氭敼瀹?`index.js` 鎴?`client.js` 蹇呴』**閲嶅惎 dsh web**锛沗vendor/` 涓嬬殑鏂囦欢鏄繍琛屾椂鎸夐渶鍔犺浇锛屾敼鍔ㄦ棤闇€閲嶅惎
  - 鍒ゆ柇鏄惁宸查噸鍚細`(Get-NetTCPConnection -LocalPort 3080 -State Listen).OwningProcess` 鍙?PID锛屾瘮璇ヨ繘绋?`StartTime` 涓?`client.js` 鐨?`LastWriteTime`

## 0.4.0锛氭寜闇€缈昏瘧锛?026-09-20锛夆€?鐮村潖鎬у彉鏇达紝鍔″繀鐭ラ亾

鐢ㄦ埛瑕佹眰锛?*鍙栨秷鑷姩鍏ㄩ〉缈昏瘧**锛屽彧鍦ㄣ€岄紶鏍囨偓鍋溿€嶆垨銆屾閫夊娈点€嶆椂缈昏瘧锛涘悓鏃朵紭鍖栭潰鏉胯瑙変笌浣撻獙锛?涓?*涓嶆薄鏌撴甯镐娇鐢ㄤ綋楠?*銆傝惤鍦版柟寮忥細

- `settings.engine` 鎭掍负 `'hover'`锛屽彧琛ㄧず銆岃Е鍙戞柟寮?= 鎸夐渶銆嶏紱闈㈡澘閲?*涓嶅啀鏈?* engine 涓嬫媺
  锛坄data-set="engine"` 宸插垹闄わ紝鏈夊绾︽祴璇曞畧鐫€锛夈€?- **銆岀敱璋佺炕銆嶆惉鍒版柊瀛楁 `settings.hoverEngine`**锛歚local`锛堥粯璁わ級/ `online` / `custom`锛?  鐢遍潰鏉裤€屽父鐢ㄣ€嶇粍閲岀殑涓嬫媺鍐冲畾锛沗translateText()` 灏鹃儴鐨勬寜闇€鍒嗘敮鎸夊畠閫夊悗绔€?  鈿狅笍 鏀硅繖涓垎鏀椂娉ㄦ剰锛氭棫瀹炵幇鏄€屽浐瀹氳惤鍥?local銆嶏紝浼氳銆屽垏鍒板湪绾垮紩鎿庛€嶅湪鎸夐渶妯″紡涓嬪け鏁堛€?- **v5 杩佺Щ**锛歚local`/`auto` 鈫?`hoverEngine=local`锛沗online` 鈫?`online`锛沗custom`/`http` 鈫?`custom`锛?  `engine='off'` 鈫?`enabled=false`锛?*鏃х殑銆屽叧闂€嶇粷涓嶈兘琚倓鎮勬墦寮€**锛夈€?- **妗嗛€夌炕璇?*锛堟柊锛夛細`selectionMode` = `popup`锛堥粯璁わ紝娴眰锛? `inline`锛堝氨鍦版浛鎹紝鐐瑰嚮椤甸潰鎴?Esc 杩樺師锛? `off`锛?  `selectionMinChars`锛堥粯璁?8锛夈€乣selMaxChars`锛堥粯璁?1200锛夈€?  - 瑙﹀彂璺緞鍙湁 `mouseup`锛坈apture锛夆啋 `selectionItem()`锛?*鍒绘剰涓嶇敤 `selectionchange`**锛岄伩鍏嶄换浣曡嚜鍔ㄨ涓恒€?  - 璺宠繃瑙勫垯澶嶇敤 `isSkipped()` + `SKIP_TAGS`锛氳緭鍏ユ銆佷唬鐮佸潡锛堥櫎寮€鍚?`translateCode`锛夈€?    contenteditable銆丆odeMirror/Monaco銆佹彃浠堕潰鏉胯嚜韬竴寰嬩笉缈汇€?  - `inline` 鍙鐞嗐€屽悓涓€鏂囨湰鑺傜偣鍐呫€嶇殑閫夊尯锛坄range.deleteContents()+insertNode`锛夛紝璺ㄦ钀借嚜鍔ㄩ€€鍥炴诞灞傦紱
    鏇挎崲鍑虹殑 `<span data-dsh-at-sel data-dsh-at-skip>` 浼氳繘 `inlineSpans`锛岄殢 `revertTranslatedNodes()` 涓€璧峰洖婊氥€?- **闈㈡澘閲嶆帓**锛氬洓涓?`<details class="grp">`锛堝父鐢?open / 寮曟搸涓庢ā鍨?/ 楂樼骇 / 璇婃柇涓庨噸缃級+ 椤堕儴
  銆屽睍寮€鍏ㄩ儴 / 鎶樺彔鍏ㄩ儴 / 绐勯潰鏉裤€嶏紱鐢ㄥ師鐢?`<details>` 鍥犳**涓嶉渶瑕佷换浣?JS 鐘舵€?*銆?- **澶撮儴妯″紡鏉?* `[data-el="modeText"]`锛氭樉绀恒€屾寜闇€ 路 鍚庣 路 妗嗛€夋柟寮?路 鏆傚仠/鏈夐敊銆嶏紱鐘舵€佽鏀逛负鍒嗘
  `' 路 '` 鎷兼帴锛堝彧鏄剧ず闈為浂娈碉級锛屼笉鍐嶆槸涓€鏁磋 ` | `銆?- 娴嬭瘯锛歚node --test "test/*.test.mjs"` 鈫?38 椤癸紱鏃?E2E锛堣嚜鍔ㄧ炕璇?娴佸紡绋冲畾鏈燂級宸叉寜鏂拌涔夐噸鍐欙紝
  鏂板妗嗛€?杩佺Щ/闈㈡澘缁撴瀯/鏂囨濂戠害娴嬭瘯銆傗殸锔?**`node --test test/` 浼氭姤 MODULE_NOT_FOUND锛屽繀椤荤敤 glob**銆?
## 0.4.2锛氱湡鏈洪獙鏀舵墦閫?+ 闈㈡澘鎸夊疄娴嬪墛鍒颁笉婊氬姩锛?026-09-20锛?
**閲岀▼纰戯細娴忚鍣ㄦˉ缁堜簬閫氫簡**锛屼粠姝よ兘鐪熸満楠屾敹锛堜箣鍓嶅叏鏄?jsdom + 鍖呬綋姣斿锛夈€?
- 鎵╁睍宸插姞杞斤細Edge `Secure Preferences` 閲?`ijgnghnilgecnfmdajmnaejfgdkkidbo`锛宍location=4`锛堣В鍘嬬缉锛夛紝
  `path=C:\Users\20549\.dsh\browser-extension`銆?*閬垮潙**锛氳瀹屾墿灞曞繀椤烩憼鍒锋柊 DSH 椤甸潰锛堝唴瀹硅剼鏈惁鍒欎笉娉ㄥ叆锛?  鈶℃墦寮€鎵╁睍渚ц竟鏍忥紙杩炴帴/瀹℃壒 UI 鍦ㄤ晶杈规爮锛夛紝鍚﹀垯 `browser_*` 涓€鐩存姤 `no browser extension is connected` /
  瀹℃壒瓒呮椂銆傛ˉ鍦板潃锛歚ws://127.0.0.1:3080/ext/bridge`锛坄/ext/bridge-config` 鍙嚜璇侊級銆?- **妗ョ殑宸ュ叿鏄函鏂囨湰鐨勶紙娌℃湁鎴浘鑳藉姏锛?*锛屾墍浠ョ湡鍍忕礌/鐪熷竷灞€瑕侀潬 `scripts/verify-browser.mjs`
  锛坄npm run verify:browser`锛夛細`puppeteer-core`锛堝湪 `~/.dsh/profiles/web/node_modules` 閲岋級+ 鏈満 Edge
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`锛?*鐙珛涓存椂 profile**锛屼笉纰扮敤鎴风殑娴忚鍣ㄦ暟鎹€?  - 鈿狅笍 鍚姩鍙傛暟蹇呴』甯?`--disable-extensions-except=`锛欵dge 宸茶瑙ｅ帇鎵╁睍鏃讹紝鍏ㄦ柊 profile 鐨勯娆″惎鍔ㄤ細琚?    鎵╁睍/棣栧惎 UI 鍗′綇锛宲uppeteer 鎶?`Timed out 鈥?waiting for the WS endpoint URL to appear in stdout`銆?  - 瀹冭兘娴?jsdom 娴嬩笉鍑虹殑涓滆タ锛氶潰鏉挎槸鍚﹂渶瑕佹粴鍔ㄣ€佹枃瀛楁槸鍚﹁瑁併€佷吉鍏冪礌绠ご鏄惁娓叉煋銆佺湡瀹為紶鏍囦簨浠躲€?- **瀹炴祴鏁版嵁锛堥潰鏉匡級**锛氭敼鍓?`鍐呭 766px / 鍙 624px`锛堜竴鎵撳紑灏辫婊氬姩锛夆啋 鏀瑰悗 **596/596锛堜笉婊氬姩锛?*銆?  鍓婃硶锛氥€屽父鐢ㄣ€? 琛屸啋4 琛岋紙enabled/hoverEngine/target/selectionMode锛夛紱鏂板鍒嗙粍銆岃Е鍙戜笌妗嗛€夈€?  锛坔overDelayMs/selectionMinChars/selMaxChars锛岄粯璁ゆ姌鍙狅級锛沗lang` 鎸埌銆岄珮绾с€嶏紱妯″紡鏉℃敼鐭瘝
  锛坄鎸夐渶 路 鏈満 路 妗嗛€夌炕璇?娴眰`锛?7px 鎶樿 鈫?29px 鍗曡锛夛紱搴曢儴鎻愮ず 83px鈫?3px锛涘ご閮?52px鈫?6px銆?- **鐪熸満琛屼负宸查獙璇?*锛氱湡瀹為紶鏍囨偓鍋?鈫?`Hello world, this needs translation.` 鈫?`澶у濂斤紝杩欓渶瑕佺炕璇戙€俙锛?  鐪熷疄 `mouseup` + 閫夊尯 鈫?娴眰 src/dst 姝ｇ‘锛涢紶鏍囩Щ鍒伴潰鏉夸笂 鈫?闈㈡澘鍐?`[data-dsh-at]` 鏍囪鏁颁负 0锛堜笉缈昏嚜宸憋級銆?
## 0.4.1锛氬ぇ閲忔閫?+ shadow DOM 绌块€忥紙2026-09-20锛?
鐢ㄦ埛闂殑涓や釜鑳藉姏锛岃惤鍦版儏鍐典笌缁撹锛?
1. **妗嗛€夊ぇ閲忕炕璇戯紙宸叉敮鎸侊級**锛歚translateSelectionItem` 鏀逛负 `chunkText(text, selChunkChars=600)`
   鍒嗗潡 鈫?閫愬潡 `translateText` 鈫?`joinPieces()` 鎸夌洰鏍囪瑷€鎷兼帴锛坺h/ja/ko 涓嶅姞绌烘牸锛屾媺涓佸姞绌烘牸锛夆啋
   娴眰閲岃竟缈昏竟鏇存柊 `[data-el="dst"]`锛宍[data-el="info"]` 鏄剧ず銆屾鍦ㄧ炕璇?i/n 娈碘€︺€?銆屽叡 n 娈点€嶃€?   - `selMaxChars` 榛樿 1200 鈫?**4000**锛岄潰鏉裤€屽父鐢ㄣ€嶇粍鏂板 `data-set="selMaxChars"`锛? = 涓嶉檺锛夛紝
     鍙︽湁 `HARD_CAP = 60000` 鍏滃簳锛涜秴闄愭椂 info 鎻愮ず銆屽凡鎸変笂闄愬彧缈诲墠 N 瀛楃銆嶄笖璇戞枃浠?`鈥 缁撳熬銆?   - 娴眰 CSS 鏀惧ぇ锛歚min(620px,52vw)` 脳 `62vh`锛宍.dst` 鍙粴鍔紙鍘熸潵 330px/250px 瑁呬笉涓嬮暱璇戞枃锛夈€?   - 姣忓潡瀹屾垚鍚庢鏌?`seq !== selSeq`锛堟柊鐨勬閫?mousedown 浼?`hideSelPop()` 鈫?`selSeq++`锛夋潵涓锛岄伩鍏嶆棫浠诲姟瑕嗙洊鏂扮粨鏋溿€?2. **DSH 澶栧３ / Web Component锛堝凡鏀寔锛?*锛氬疄娴?**DSH 鍏ㄩ儴 `dsh-client-ui-*` 瀹㈡埛绔兘涓嶄娇鐢?shadow DOM**
   锛堟壂鎻忎簡 dsh-app rc.2 涓?46 涓?client.js锛歛ttachShadow 璁℃暟鍏ㄤ负 0锛夆啋 澶栧３鏂囧瓧鏈潵灏卞湪鍏?DOM锛屾偓鍋?妗嗛€夐兘鑳界炕銆?   鍞竴鐢?shadow DOM 鐨勬槸鏈彃浠惰嚜宸辩殑闈㈡澘銆備絾浜嬩欢浠?shadow root 鍐掑嚭鏉ユ椂 `e.target` 浼氳閲嶅畾鍚戞垚瀹夸富锛?   鏃у疄鐜拌蛋鍒板涓绘椂銆岃嚜韬棤鏂囨湰 鈫?涓€璺悜涓?鈫?浠€涔堥兘涓嶇炕銆嶁啋 鐜板湪鐢?`composedTarget(e)`锛坄e.composedPath()`锛?   鍙栨渶鍐呭眰鐪熷疄鍏冪礌锛學eb Component 鍐呴儴鏂囧瓧涔熻兘缈伙紱璺緞閲屽嚭鐜?`ROOT_ID` 鎴?`[data-dsh-at-skip]` 鐩存帴鏀惧純銆?   鍚屾椂 `resetTranslationState()` 鐨勬爣璁版竻鐞嗘敼涓?`allMarkedHosts()`锛堥€掑綊鏀堕泦 shadow root锛夛紝
   鍚﹀垯 shadow 鍐呮畫鐣?`data-dsh-at` 浼氳閭ｅ潡銆屾棦缈讳笉鍔ㄤ篃澶嶅師涓嶄簡銆嶃€?3. **缈讳笉鍒扮殑鍦版柟锛堟灦鏋勯檺鍒讹紝涓嶈鎵胯锛?*锛欴SH 椤甸潰涔嬪鐨勭晫闈?鈥斺€?鍒殑鏍囩椤?/ 鍏跺畠缃戠珯 / 妗岄潰鍘熺敓 App銆?   瀹㈡埛绔彃浠跺彧娉ㄥ叆 DSH 鐨?Web 鐣岄潰锛宍dsh-browser` 閭ｇ被鎵╁睍鎵嶆槸鎷垮埆鐨勬爣绛鹃〉鐨勮矾瀛愩€?
- 娴嬭瘯锛?*45 椤?*锛堟柊澧烇細澶ч噺妗嗛€変袱渚嬨€佸澹宠鐩栦竴渚嬨€乄eb Component 涓€渚嬨€佷袱鏉″绾︼級銆?- 鈿狅笍 鍐?`package.json` 鍒敤 `Set-Content -Encoding utf8`锛圥S 5.1 浼氬啓 **BOM + CRLF**锛宍JSON.parse` 鐩存帴鎶?  `Unexpected token '锘?`锛夆啋 鐢?`node -e "...fs.writeFileSync(...,'utf8')"` 骞舵牳瀵归瀛楄妭涓嶆槸 239,187,191銆?
## 鍏抽敭璺緞

| 浣滅敤 | 璺緞 |
| --- | --- |
| 瀹夸富鍗婏紙璺敱 / 妯″瀷浠ｇ悊 / 璇婃柇锛?| `index.js` |
| 娴忚鍣ㄥ崐锛堟壂鎻?/ 缈昏瘧 / 鎮仠 / 闈㈡澘锛?| `client.js` |
| 鎺ㄧ悊 Worker锛圵ASM锛?| `vendor/worker.v5.js` |
| 鍐呯疆搴擄紙transformers 娴忚鍣?ESM锛?| `vendor/transformers.esm.v2.js` |
| ORT 杩愯鏃讹紙loader 鍏ュ簱锛寃asm 璧?CDN 鍏滃簳锛?| `vendor/ort/` |
| 瀹夸富妯″瀷纾佺洏缂撳瓨 | `$DSH_HOME/dsh-auto-translate/models`锛堢害 860MB锛?|
| 瀹夸富 ORT 鍏滃簳缂撳瓨 | `$DSH_HOME/dsh-auto-translate/ort-cache` |
| 璇婃柇钀界洏 | `$DSH_HOME/dsh-auto-translate/diagnose-*.json`锛堝彧鐣欐渶杩?20 浠斤級 |
| 閲嶅惎鑴氭湰 | `C:/Users/20549/.dsh/restart-dsh-web.ps1` |
| 淇濋櫓閲嶅惎锛圫HA 姣斿锛屽箓绛夛級 | `C:/Users/20549/.dsh/restart-guard.ps1` |

## dsh 鏈綋锛氬凡鍗囧埌 0.1.5-rc.2锛?026-09-17锛?
- 杩愯璺緞锛?*宸叉惉杩佸埌绋冲畾鐩綍**锛夛細`C:\Users\20549\.dsh\dsh-app\0.1.5-rc.2\node_modules\@deepseek-ai\dsh\lib\bin.js`
  - 鎼縼鍘熷洜锛氬師璺緞鍦?npx 缂撳瓨閲岋紝浼氳 npx 鑷姩娓呯悊銆佷笖璺緞甯﹀搱甯屼笉鍙淮鎶ゃ€傛惉杩佹槸**鍚岀洰褰曞鍒?*锛?    妯″潡瑙ｆ瀽璺緞涓嶅彉锛堝疄娴嬪惎鍔ㄦ垚鍔熷苟鍔犺浇鍏ㄩ儴鎻掍欢锛夈€?  - `restart-dsh-web.ps1` 宸叉寚鍚戠ǔ瀹氱洰褰曪紙澶囦唤 `restart-dsh-web.ps1.bak-before-stable`锛夈€?- 鍘?rc.1 瀹夎**淇濇寔涓嶅姩**锛坄_npx\1e7f6d9597241db0`锛夛紝闅忔椂鍙洖婊氥€?- 鍗囩骇鍔ㄦ満锛歚Lum1104/dsh-browser` 鐨勬ˉ鎺ユ彃浠?pin 浜嗘渶浣?`0.1.5-rc.2`锛圧EADME 鏄庤 older releases are not supported锛夈€?- rc.1 鈫?rc.2 鐨勫樊寮傚緢灏忥細渚濊禆鏁板悓涓?72锛屾棤澧炲垹锛屼粎 65 涓?`@deepseek-ai/*` 浠?`^0.1.5-rc.1` 鎶埌 `^0.1.5-rc.2`锛沚in/engines 缁撴瀯涓嶅彉銆?- **鍏煎鎬у疄娴嬬粨璁猴紙閲嶈锛?*锛歚@nanmicoder/dsh-agent-teams` 鍦?rc.2 涓?*瀹樻柟涓嶆敮鎸?*鈥斺€斿畠鑷甫鐨?  `scripts/doctor.mjs` 鐩存帴鎶?`FAIL: Unsupported host 0.1.5-rc.2; recommended target is 0.1.5-rc.1`
  锛坄compatibility.json` 鐨?supportedHosts 鍙湁 0.1.5-rc.1 / 0.1.2-rc.1 / 0.1.2-alpha.5 / 0.1.2-alpha.2锛夈€?  **浣嗗伐鍏风‘瀹炴敞鍐屼笖鍙皟鐢?*锛坄agent_teams_status` 姝ｅ父鍝嶅簲锛夛紝鎵€浠ュ睘浜庛€岃兘璺戜絾涓嶅湪鏀寔鐭╅樀鍐呫€嶃€?  `dsh-vision-router` 鐨?peer 涔熷彧鍒楀埌 rc.1锛屼絾瑙嗗彛宸ュ叿鍦ㄦ湰鏈哄疄娴嬪彲鐢ㄣ€?  鍑哄彜鎬涓烘椂绗竴瀚岀枒灏辨槸鐗堟湰涓嶅尮閰嶏紝鍥炴粴瑙佷笅銆?
### 閲嶅惎鑴氭湰鐨勪笁涓潙锛堝墠涓や釜宸蹭慨锛岀涓変釜鏄?2026-09-17 鏂板彂鐜帮級

1. **蹇呴』銆屽瓙杩涚▼浼樺厛銆嶆潃**锛氳剼鏈師鏉ユ寜鍛戒护琛屽尮閰嶆潃杩涚▼锛屼細鍏堟潃 npx 鍖呰杩涚▼锛涘畠 spawn 鐨?   `bin.js web` 瀛愯繘绋嬩細琚?Windows 瀛ょ珛骞?*缁х画鎸佹湁 3080**锛岄€犳垚銆岄噸鍚悗绔彛娌￠噴鏀俱€嶇殑鍋囧け璐ャ€?   鐜版敼涓猴細鍏堟寜绔彛鍙嶆煡 owner锛屽啀鎸夊懡浠よ鍖归厤锛?*闄嶅簭 + 鏈€澶?3 杞噸璇?*銆?2. **鍒敤瀹芥潯浠舵壒閲忔潃杩涚▼**锛氭垜鏇剧敤銆屽懡浠よ鍚?dsh銆嶇殑鏉′欢娓呯悊娈嬬暀锛?*璇潃浜?dsh 鍐呴儴鐨?   `subprocess-local` Job runner**锛屽鑷翠箣鍚庢墍鏈夌粓绔懡浠ゆ姤
   `subprocess-local: Windows Job runner exited with exit code 4294967295`锛堟墽琛屽櫒褰诲簳澶辨晥锛夈€?   姝ｇ‘鍋氭硶鏄?*鍙寜绔彛鍙嶆煡 owner PID** 绮剧‘娓呯悊銆?3. **瀛ゅ効杩涚▼鍙兘鏉€涓嶆帀 鈫?閲嶅惎闈欓粯銆屾垚鍔熶絾娌″垏鎹€?*锛?026-09-17 瀹炴祴锛夛細
   鏈嶅姟杩涚▼锛圥ID 15516锛夌殑鐖惰繘绋嬫棭宸查€€鍑猴紝灞?*瀛ゅ効杩涚▼**锛涜剼鏈棩蹇楁槑鏄庡啓浜?   `round 1 killing PID 15516`锛屼絾璇ヨ繘绋?*渚濈劧瀛樻椿骞剁户缁寔鏈?3080**锛屼簬鏄剼鏈悗缁?   鍚姩鐨勬柊瀹炰緥**鑷閫€鍑?*锛堟湭鎶㈠崰绔彛锛夛紝缁撴灉鏄?*鏃ц繘绋嬬户缁湇鍔°€佹柊閰嶇疆鏈姞杞?*锛?   鑰屾棩蹇楅噷**娌℃湁浠讳綍澶辫触瀛楁牱**鈥斺€斿彧鐪嬪埌 `killing 鈥 灏辨柇浜嗭紝寰堝鏄撹鍒や负銆岄噸鍚垚鍔熴€嶃€?   - **璇嗗埆鏂规硶**锛氶噸鍚悗鏍稿銆?080 owner 鐨勫惎鍔ㄦ椂闂淬€嶆槸鍚?*鍙樻柊**锛屽苟纭瀹冪殑鍛戒护琛屾寚鍚?*鐩爣 bin**銆?     鍙湅鍒?`killing PID`/`launched PID` 涓嶈冻浠ヨ瘉鏄庡垏鎹㈡垚鍔熴€?   - **姝ｇ‘鏍稿**锛?     `Get-NetTCPConnection -LocalPort 3080 -State Listen` 鍙?owner 鈫?姣?`CreationDate` 涓庤杩涚▼鐨?`CommandLine`銆?   - **澶勭悊**锛氭敼鐢?*绠＄悊鍛樻潈闄?*鐨勭粓绔粨鏉熻 PID锛堟垨鐢ㄤ换鍔＄鐞嗗櫒銆岀粨鏉熶换鍔°€嶏級锛屽啀璺戦噸鍚剼鏈紱
     鎹㈣█涔嬶紝闈炵鐞嗗憳涓婁笅鏂囦笅瀵瑰鍎胯繘绋嬬殑 `Stop-Process` 涓嶄繚璇佺敓鏁堛€?   - **濂芥秷鎭?*锛氳繖绉嶅け璐ユ槸**鏃犲**鐨勨€斺€旀湇鍔′笉浼氫腑鏂紝鍙槸鍋滅暀鍦ㄦ棫閰嶇疆涓娿€?
### 鍥炴粴 rc.2 鈫?rc.1

    Copy-Item "$env:USERPROFILE\.dsh\restart-dsh-web.ps1.bak-before-rc2" "$env:USERPROFILE\.dsh\restart-dsh-web.ps1" -Force
    # 鍐嶈窇閲嶅惎鑴氭湰锛堟垨鍏堟寜绔彛鏉€鎺?3080 鐨?owner PID锛?
### 妗岄潰鍏ュ彛涓庢湰鍦板寲鍐崇瓥锛?026-09-17锛?
- **涓嶅仛鍏ㄥ眬瀹夎**锛坄npm i -g`锛夛細浼氭敼鍙樻ā鍧楄В鏋愭牴锛屾湁璁?18 涓?link 鍦?profile 鐨勬彃浠堕泦浣撴壘涓嶅埌渚濊禆鐨勯闄┿€?  鏀逛负**鎶婂畨瑁呮惉鍒扮ǔ瀹氱洰褰?* `~\.dsh\dsh-app\0.1.5-rc.2`锛堝悓鐩綍澶嶅埗銆侀浂瑙ｆ瀽椋庨櫓銆佸疄娴嬪彲鍚姩锛夈€?- **妗岄潰蹇嵎鏂瑰紡**锛歚鈽?DSH 涓荤晫闈紙鍙屽嚮杩涘叆锛?lnk` 鈫?Edge 鎵撳紑
  `http://127.0.0.1:3080/?token=<token>`銆?*蹇呴』甯?token**锛堜笉甯﹁繑鍥?401锛夈€?  - token **涓嶅啓鐩?*锛屼篃涓嶈浆 Cookie锛屾瘡娆″惎鍔ㄦ墦鍗板湪 `dsh-web-server.log` 鐨?`dsh web: http://鈥?token=` 琛屻€?  - 鍙栨柊 token锛歚Get-Content "$env:USERPROFILE\.dsh\dsh-web-server.log" | Select-String 'token=' | Select-Object -Last 1`
  - 鏀瑰揩鎹锋柟寮忥細鍙抽敭 `.lnk` 鈫?灞炴€?鈫?鏀圭洰鏍?URL 鐨?token 娈点€?  - **`msedge.exe --app=<url>` 鍦ㄦ湰鏈烘棤鏁?*锛欵dge 宸插湪杩愯鏃朵細鎶?`--app` 璺敱鍒扮幇鏈夊疄渚嬨€佸綋鏍囩椤靛杩涘凡鏈夌獥鍙?    锛堣繘绋嬮噷鏌ヤ笉鍒扮嫭绔?`--app` 绐楀彛锛夈€傝鐪熺嫭绔嬬獥鍙ｅ繀椤诲姞**涓撶敤 `--user-data-dir`**锛屼唬浠锋槸涓嶅叡浜櫥褰曟€併€?
## AgentTeams锛堝崗浣滄彃浠讹級鐢ㄦ硶涓庣増鏈鍛?
- 瑙﹀彂鏂瑰紡锛氳嚜鐒惰瑷€锛堛€岀敤 AgentTeams 鍋?X銆嶏級銆乣/agent-teams <鐩爣>`銆佹垨鐩存帴璋冪敤 `agent_teams_*` 宸ュ叿銆?- 鐣岄潰鍏ュ彛锛氬洟闃熻繍琛屾椂**娲诲姩闈㈡澘鍑虹幇鍦ㄥ璇濋噷**锛堝垎娈佃繘搴︺€佹垚鍛樻爲銆佷换鍔?DAG锛夛紝**涓嶅湪璁剧疆椤?*銆?- 鐘舵€佽惤鐩橈細`<浼氳瘽宸ヤ綔鍖?/.agent-teams/<teamId>/`锛坄team.json` + 鍚勬垚鍛?`inbox/*.jsonl`锛夈€?- 瀹℃牳娴佺▼锛歚agent_teams_create({approval:"required"})` 鍙惤鐩樺彲缂栬緫鑽夋锛堜笉寤哄瓙浼氳瘽銆佷笉棰嗕换鍔★級鈫?  鐢ㄦ埛鍦?Web 鐣岄潰缂栬緫/鎵瑰噯 鈫?璋冨害鍣ㄦ墠娲惧彂銆?*Captain 涓嶅緱鍦ㄥ悓涓€杞嚜琛屾壒鍑嗐€?*
- 鈿狅笍 **鐗堟湰**锛氳鎻掍欢瀹樻柟鍙敮鎸佸埌 `0.1.5-rc.1`锛屾湰鏈烘槸 rc.2锛堣涓婏級銆俤octor 鎶?FAIL 浣嗗伐鍏峰彲鐢ㄣ€?

## dsh-browser锛堟祻瑙堝櫒妗ユ帴 + Chrome/Edge 鎵╁睍锛?026-09-17 瀹夎锛?
- 妗ユ帴鎻掍欢锛歚@yuxianglin/dsh-bridge-browser@0.0.5`锛宩unction 鎸囧悜 `profiles/web/.dsh-browser-source`锛屽凡鍦?profile bundles 绗?18 椤广€?- 鎵╁睍浜х墿锛歚~/.dsh/browser-extension`锛坄manifest.json` v0.1.4 + `background.js` + `content.js` + `panel/`锛夈€?- 瀹夎鏂瑰紡锛氫粠**宸插杩囩殑鏈湴 tarball** 璺?`scripts/install.ps1`锛?*涓嶈**鐢ㄥ畼鏂圭殑 `irm 鈥?| powershell`锛?  涓?`raw.githubusercontent.com` 鍦ㄦ湰鏈轰笉鍙揪锛夈€傝剼鏈€€鍑虹爜 0锛? 姝ュ叏杩囥€?- **鎵╁睍鏉冮檺锛堝繀椤荤煡鎯咃級**锛歚host_permissions: http://*/* https://*/*` + `scripting` + `tabs` + `webNavigation`
  = 鍙鍐欎綘璁块棶鐨勬墍鏈夌綉椤碉紱**鏈０鏄?`nativeMessaging`**锛堜笉鑳界洿鎺ヨ皟鐢ㄦ湰鏈哄彲鎵ц鏂囦欢锛屽彧鑳借蛋鏈満鍥炵幆 HTTP锛夈€?- 鍔犺浇鏂瑰紡锛氬洜涓烘病鏈?Chrome锛岃剼鏈湭鑳借嚜鍔ㄦ墦寮€銆傜敤 Edge锛歚edge://extensions` 鈫?寮€鍙戜汉鍛樻ā寮?鈫?  鍔犺浇瑙ｅ帇缂╃殑鎵╁睍 鈫?閫?`C:\Users\20549\.dsh\browser-extension`銆傝嫢 Edge 鐨勪晶杈规爮 API 涓?Chrome 涓嶅吋瀹癸紝闇€鍙﹁銆?
## AgentTeams 瀹炴垬锛氬绾﹀潙娓呭崟锛?026-09-17 棣栨鐪熷疄璺戦€氾級

棣栨鐢?AgentTeams 鍋氫簡銆宻tatus.ps1 澧炲姞 npm 鐗堟湰婕傜Щ鎻愮ず銆嶏紙鎻愪氦 `2ef1af5`锛屽洟闃?`translate-status-drift-2`锛夈€?**娴佺▼鏈韩瀹屽叏璺戦€?*锛氳崏妗?鈫?Web 鐣岄潰鎵瑰噯 鈫?璋冨害娲惧彂 鈫?棰嗗彇 鈫?瀹炵幇 鈫?鐙珛楠岃瘉锛?/5锛夆啋 瀹℃煡锛坴erdict=pass锛夈€?浣嗘垜鍦?*鍐欏绾?*涓婅俯浜嗕笁涓潙锛屽叏閮ㄥ€煎緱璁板綍锛?
1. **璺ㄥ伐浣滃尯鏂囦欢蹇呴』鐢ㄣ€屽伐浣滃尯鐩稿鍒悕銆?*銆傛垜鎶?`inScope` 鍐欐垚缁濆璺緞
   `C:\Users\20549\.dsh\plugins\dsh-auto-translate\scripts\status.ps1`锛岃€屽畠鍦ㄤ細璇濆伐浣滃尯涔嬪 鈫?   `dsh-agent-teams/lib/quality-gates.js` 鐨?`normalizeWorkspacePath()` 瀵圭粷瀵硅矾寰勮繑鍥?`undefined`
   鈫?鍒?`illegal`锛沗pathMatchesScope()` 瀵圭洏绗﹀紑澶寸殑妯″紡鎭?`false` 鈫?浠讳綍鐩稿 changedPath 閮藉垽 `undeclared`銆?   **瀹屾垚鏃跺己鍒舵瘡涓?changedPath 灞炰簬 in_scope 鈬?浠诲姟缁撴瀯涓婁笉鍙兘 completed**锛坱1 鍥犳 failed锛屼唬鐮佹病闂锛夈€?   姝ｇ‘濮垮娍锛歚inScope: ["scripts/status.ps1"]` + 鍦?objective 閲屾敞鏄庣湡瀹炵墿鐞嗕綅缃紱鎻愪氦 changedPaths 鐢ㄥ悓涓€鍒悕銆?   - `amend_task` 瀵?*宸?terminal锛坒ailed锛?*鐨勪换鍔′細琚嫆锛坄terminal contracts are immutable`锛夛紝
     琛ユ晳鍔炴硶鏄?*鏂板缓涓€涓绾︽纭殑浠诲姟**锛屽啀鐢?`edit_plan update_task` 鎶婁笅娓镐緷璧栧師瀛愭敼鎸囪繃鍘汇€?2. **verify 鍛戒护蹇呴』鍦ㄦ湰鏈鸿兘瀛楅潰鎵ц**銆傛垜鍐欎簡 `pwsh -NoProfile -Command 鈥锛屼絾鏈満**涓嶅瓨鍦?PowerShell 7**
   锛坄Get-Command pwsh` 鏈懡涓紱Program Files / Program Files (x86) / WindowsApps 涓変釜鏍囧噯浣嶇疆閮芥病鏈夛級锛?   鍙湁 Windows PowerShell 5.1 Desktop銆傜敤 `powershell.exe` 閲嶅啓鍗冲彲銆?   鍙︽敞鎰忥細`status.ps1` 鍦ㄥ瓙杩涚▼ PATH 鏃?`dsh` 鏃朵細鍦?`& dsh plugin --profile web list` 鎶涢敊骞?*涓鏁翠釜 Get-Status**
   锛堟棦鏈夎涓猴級锛屾墍浠?verify 閲岃鏄惧紡鍓嶇疆 dsh 鐨?`.bin`锛歚node_modules\.bin`銆?3. **`amend_task` 鍙紶閮ㄥ垎瀛楁鏃讹紝鍏朵綑瀛楁浼氳榛樿鍊艰鐩?*銆傛垜绗簩娆″彧浼?`verify` 鍘绘敼 t3锛岀粨鏋滃畠鐨?   瀹℃煡涓撶敤 objective 琚浛鎹㈡垚閫氱敤鏂囨 `Review whether the latest implementation satisfies the user goal`锛?   涓斻€屽繀椤荤粰鍑?verdict銆嶈繖鏉￠獙鏀朵涪澶便€傝ˉ鏁戯細鐢?*瀹屾暣 objective + acceptance** 鍐?amend 涓€娆★紙t3 鐜版湁 2 鏉′慨璁㈣褰曪級銆?   **鏁欒锛歛mend 瑕佷箞缁欏叏瀛楁锛岃涔堝埆鐢ㄣ€?*

鍏朵粬瑙傚療锛?- 鎴愬憳 `reasoning_effort` **涓€鏃︽壒鍑嗗氨涓嶈兘鏀?*锛堣繍琛屼腑鍥㈤槦鍙厑璁告敼鏈紑濮嬩换鍔＄殑渚濊禆锛夛紝灏忎换鍔″簲棰勫厛鐢?low銆?- 灏忎换鍔＄敤 AgentTeams 鏄?*浜忕殑**锛氫笁灞備覆琛岋紙瀹炵幇鈫掔嫭绔嬮獙璇佲啋鐙珛瀹℃煡锛夋妸 30 绉掔殑娲绘媺鎴愬崄鍑犲垎閽燂紱
  瀹冪殑浠峰€煎湪**澶т换鍔℃垨楂橀闄╂敼鍔?*涓婏紙闃叉涓€涓?Agent 鑷鑷瘽锛夈€傛湰娆℃槸鍐掔儫娴嬭瘯锛屾墍浠ュ€煎緱銆?- 璐ㄩ噺闂?*涓嶆斁姘?*锛歵1 鍥犲绾﹂潪娉曡鍒?failed 骞跺甫缁撴瀯鍖?finding锛岃€屼笉鏄噾鍚堢畻杩団€斺€旇繖鏄彲淇″害鏉ユ簮銆?
### 宸蹭慨锛堜綆鍗憋紝楠岃瘉鑰呭彂鐜?鈫?澶嶇幇纭 鈫?淇锛?
`status.ps1` 鐨?npm 鏌ヨ鍒ゅ畾锛歯pm 鍦?E404 / registry 涓嶅彲杈炬椂浼氭妸 `{"error":{鈥}` 鍐欏埌 **stdout**锛?鑰屽垽瀹氬彧鐢?`$raw -match '\{'` 鈫?璇垽 `npm.ok = $true`銆乣version` 涓虹┖锛?浜庢槸澶辫触鍦烘櫙鏄剧ず鎴?`differs from npm  (order not comparable)`锛堝弻绌烘牸锛夎€岄潪
`cannot compare: 鈥?(registry query failed)`銆?*闈為潤榛樸€佷笉褰卞搷楠屾敹**銆?
淇锛氬湪 `$meta` 瑙ｆ瀽鍚庤ˉ涓€灞傚垽瀹氣€斺€擿if ($meta -and (-not $meta.version)) { $meta = $null; ... }`锛?鍗炽€屾病鏈?version 灏变笉绠楁煡璇㈡垚鍔熴€嶃€傚疄娴嬶細妯℃嫙 npm 杈撳嚭 error JSON 鏃剁幇鍦ㄦ纭覆鏌?`[!] cannot compare: local 鈥?vs npm (registry query failed)`锛涙甯稿満鏅粛娓叉煋 sync 琛岋紱
0 闈?ASCII / 鏃?BOM / 绾?LF / PS 5.1 瑙ｆ瀽 0 閿欒 / 27 椤规祴璇曞叏缁裤€?

## 闅忔椂鏌ョ湅鐘舵€侊紙涓変釜鍏ュ彛锛?
- 妗岄潰蹇嵎鏂瑰紡锛?*`dsh-translate 鐘舵€侀潰鏉縛**锛堜氦浜掑紡鎺у埗鍙帮紝`-NoExit` 鎵€浠ヤ笉浼氶棯閫€锛変笌
  **`dsh-translate 浠〃鐩榒**锛堝厛鍒锋柊蹇収鍐嶇敤 Edge/Chrome 搴旂敤妯″紡鎵撳紑 `dashboard.html`锛夈€?  蹇嵎鏂瑰紡鎸囧悜 `scripts/status.ps1` 涓?`scripts/open-dashboard.vbs`锛岄噸寤烘柟寮忚鏈妭鏈熬銆?  妗岄潰涓婅繕鐩存帴鏀句簡涓€浠?`dsh-translate 浠〃鐩?html`锛堝弻鍑诲嵆寮€锛屼笉渚濊禆蹇嵎鏂瑰紡锛夈€?
## 浣跨敤閲忔寚鏍囷紙鑳界湅浠€涔堛€佺湅涓嶅埌浠€涔堬級

- **鑳界湅**锛歯pm 涓嬭浇閲忥紙瀹樻柟 `api.npmjs.org/downloads`锛岄潰鏉挎樉绀哄懆/鏈堬紝浠〃鐩樺彟鏈夎繎 14 澶╂煴鐘跺浘锛夛紱
  Gitee 鐨?star / fork / watch / open issue锛坄gitee.com/api/v5/repos/...`锛夈€備袱鑰呴兘鏄叕寮€鎺ュ彛銆佹棤闇€鍑嵁銆?- **鐪嬩笉鍒?*锛?*鍖呴〉娴忚閲?/ PV**鈥斺€攏pm 涓?Gitee 閮戒笉瀵瑰鎻愪緵璇ョ淮搴︾殑缁熻锛坣pm 鏃犱换浣曞寘绾ф祻瑙堟帴鍙ｏ紝
  鎺㈡祴 `/package/<name>/stats` 涓?`/downloads` 涔嬪鐨勭鐐瑰叏 404锛夛紱Gitee 鐨勮闂?鍏嬮殕缁熻**鍙湁浠撳簱鎷ユ湁鑰?  鐧诲綍鍚庡彲瑙?*锛坄/traffic` 涓?API 鐨?traffic 绔偣瀵瑰鍧?404锛夛紝鎵€浠ュ彧鏀剧洿杈鹃摼鎺ョ敱浣犺嚜宸辩湅銆?- **鏂板寘寤惰繜**锛歯pm 瀵瑰垰鍙戝竷鐨勫寘**褰撳ぉ娌℃湁涓嬭浇鏁版嵁**锛坉ownloads API 杩斿洖 404锛屽鐓?`jsdom` 姝ｅ父锛夛紝
  閫氬父绗簩澶╁紑濮嬭鏁般€傞潰鏉夸細鏄剧ず `n/a` 骞剁粰鍑?Yellow 鎻愮ず锛屼笉鏄晠闅溿€?- 缁撴瀯涓婃棤娉曠粺璁°€屾湁澶氬皯浜烘湰鍦?link/tgz 瀹夎浜嗘彃浠躲€嶁€斺€旀病鏈夊洖浼犻€氶亾銆?
- 鎺у埗鍙伴潰鏉匡細

      powershell -ExecutionPolicy Bypass -File scripts/status.ps1            # 涓€灞忥細鏈湴浠撳簱 / Gitee / npm / 鎸囨爣 / 瀹夎鎬?      powershell -ExecutionPolicy Bypass -File scripts/status.ps1 -Open      # 鍚屾椂鎵撳紑 npm 涓?Gitee 椤甸潰
      powershell -ExecutionPolicy Bypass -File scripts/status.ps1 -Watch 30  # 姣?30 绉掕嚜鍔ㄥ埛鏂?
- HTML 浠〃鐩橈紙涓枃鐣岄潰銆佸彲涓€閿鍒跺畨瑁呭懡浠ゃ€侀〉闈㈠唴鍙疄鏃舵媺 npm/Gitee锛夛細

      node scripts/dashboard.mjs           # 鐢熸垚 dashboard.html锛堝凡 gitignore锛?      node scripts/dashboard.mjs --open    # 鐢熸垚骞舵墦寮€

> **缂栫爜鍧戯紙閲嶈锛?*锛歚scripts/status.ps1`銆乣publish.ps1`銆乣open-dashboard.vbs` 鍏ㄩ儴**鍒绘剰鍐欐垚绾?ASCII**銆?> 鍘熷洜鏄?Windows PowerShell 5.1 / wscript 璇诲彇**鏃?BOM 鐨?UTF-8** 鏂囦欢鏃舵寜 GBK 瑙ｉ噴锛屼腑鏂囧瓧绗︿覆瀛楅潰閲忕殑
> 鏈瓧鑺傚彲鑳芥挒涓?`'`锛屾妸鏁翠釜鑴氭湰鎾曟垚闈炴硶 token 鑰岃В鏋愬け璐ワ紙瀹炴祴杩囦袱娆★級銆傛墍浠ュ嚒鏄?`.ps1`/`.vbs` 涓€寰?ASCII锛?> 闇€瑕佷腑鏂囩晫闈㈠氨浜ょ粰 Node 鑴氭湰锛圢ode 鎭掑畾鎸?UTF-8 璇绘枃浠讹級銆?
## 甯哥敤鍛戒护

    cd C:\Users\20549\.dsh\plugins\dsh-auto-translate
    npm test              # 11 椤圭绾挎祴璇曪細濂戠害 + i18n + jsdom E2E
    npm run fetch-vendor  # 閲嶅缓 vendor/锛堟崲鏈哄櫒鎴栬瀹屽叏绂荤嚎鏃讹級
    powershell -File scripts/publish.ps1 -Target slimzip   # 鐢熸垚缁?Gitee 缃戦〉涓婁紶鐨勫寘
    git push gitee main

## 鎺ㄩ€佸埌 Gitee锛堣俯杩囩殑鍧戯級

- 鍑嵁鐢?Git Credential Manager 绠＄悊锛屽嚟鎹潯鐩悕锛歚LegacyGeneric:target=git:https://gitee.com`銆?- **鍧?*锛歐indows 鍑嵁閲屾畫鐣欒繃涓€涓?15 瀛楃鐨?`enc!鈥 鍔犲瘑鍗犱綅涓诧紝瀵艰嚧 git 鍙嶅閲嶈瘯璁よ瘉锛屾渶鍚庢姤
  `fatal: the remote end hung up unexpectedly`鈥斺€旇〃鐜板儚缃戠粶闂锛屽疄璐ㄦ槸鍧忓嚟鎹€?  澶勭悊锛歚cmdkey /delete:"LegacyGeneric:target=git:https://gitee.com"`锛岄噸鏂?push 骞跺湪寮瑰嚭鐨?  GCM 绐楀彛閲岀敤**绉佷汉浠ょ墝**锛圙itee 鈫?璁剧疆 鈫?绉佷汉浠ょ墝锛屽嬀 `projects`锛夌櫥褰曘€?- 鍒ゆ柇鍑嵁鏄惁鏈夋晥锛歚git push --dry-run https://gitee.com/nysjn/__not-a-repo__.git main`
  杩斿洖 `remote: 404 not found!` 璇存槑**璁よ瘉宸查€氳繃**锛堝彧鏄粨搴撲笉瀛樺湪锛夛紱杩斿洖 401 鎵嶆槸鍑嵁鏃犳晥銆?- push 闇€瑕?GUI 浼氳瘽鎵嶈兘寮瑰嚟鎹獥锛屽墠鍙拌窇浼氳宸ュ叿瓒呮椂鎺愭柇锛涚敤鍚庡彴浠诲姟 + 鏃ュ織鏂囦欢瑙傚療銆?
## 鍙戝竷鍒?npm锛堣俯杩囩殑鍧戯級

- 璐﹀彿 `nysjn`锛堥偖绠?3305406477@qq.com锛屼細鍏紑鏄剧ず鍦ㄥ寘椤典笂锛夈€傚寘鍚?`dsh-auto-translate`锛?026-09-16 鍙戝竷 0.2.0銆?- **鍧?1锛歚npm login --auth-type=web` 涓嶈兘鏀惧湪鍚庡彴浠诲姟閲岃窇**鈥斺€旀嬁涓嶅埌 stdin 鏃朵細閫€鍖栨垚 `Username:` 鎻愮ず锛?  绌烘彁浜ょ洿鎺?exit 1锛宍.npmrc` 涓嶇敓鎴愶紙`npm whoami` 浠?ENEEDAUTH锛夈€傚繀椤昏鐢ㄦ埛鍦?*鑷繁鐨勭粓绔?*閲岃窇銆?- **鍧?2锛氭敞鍐屾椂鐨勩€岄偖绠变竴娆℃€у瘑鐮併€嶄笉绛変簬 npm 鐧诲綍瀵嗙爜**锛屽埆娣枫€?- **鍧?3锛歯pm 鐜板湪鎷掔粷銆屾病寮€ 2FA 鐨勮处鍙枫€嶅彂甯?*锛屾姤
  `E403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages`銆?  `npm profile get` 閲?`tfa: False` 灏辨槸鏍瑰洜銆傚姞 `--otp=` 涔熸棤鏁堬紙璐﹀彿娌″紑 2FA 鏃舵湇鍔″櫒涓嶆牎楠?OTP锛夈€?- **鍙瑙?*锛氬湪 https://www.npmjs.com/settings/nysjn/tokens 寤?**Granular Access Token**锛屽繀椤诲仛鍒颁笁浠朵簨鈥斺€?  鈶?鍕?`Bypass two-factor authentication (2FA)`锛涒憽 Permissions 閫?`Read and write (publish and stage)`锛?  鈶?Select packages 閫?`All packages`銆備笁椤圭己涓€锛岀敓鎴愮殑浠ょ墝鏉冮檺灏辨槸绌虹殑锛圫ummary 浼氬啓 `0 packages`锛夈€?- 鍙戝竷鍛戒护锛堜护鐗屽彧涓存椂鐢ㄤ竴娆★紝鍙戝畬绔嬪埢鍒狅級锛?  `npm config set //registry.npmjs.org/:_authToken=<浠ょ墝>` 鈫?`npm publish --access public` 鈫?`npm config delete //registry.npmjs.org/:_authToken`
- 涓や釜鍙嶇洿瑙夌偣锛氣憼 `www.npmjs.com` 瀵硅剼鏈姹傝繑鍥?**403**锛圕loudflare锛夛紝浣?`registry.npmjs.com` 姝ｅ父锛?  鈶?**npm 娌℃湁缃戦〉涓婁紶 tgz 鐨勫叆鍙?*锛宍npmjs.com/package/upload` 浼氳褰撴垚銆屽寘鍚?upload銆嶈В鏋愶紝鍒璇銆?- 鍙戝竷鍚?`npm view` 鍙兘浠?404 鏁板崄绉掞紙CDN 鏈埛鏂帮級锛?*涓嶄唬琛ㄥけ璐?*锛涗互 `npm publish` 杈撳嚭閲岀殑
  `+ dsh-auto-translate@0.2.0` 涓哄噯銆?- 瀹樻柟鍏憡锛歜ypass-2fa 浠ょ墝 **2027 骞?1 鏈堣捣涓嶈兘鍐嶇洿鎺ュ彂甯?*锛屽眾鏃堕渶鏀圭敤 Trusted Publishing锛堜緷璧?GitHub Actions锛?  鏈満 GitHub 涓嶉€氾級鎴?staged publishing銆備互鍚庤鍙戞柊鐗堟湰锛屾渶鐪佷簨鐨勪粛鏄€屼复鏃跺缓涓€鏋?bypass 浠ょ墝 鈫?鍙?鈫?鍚婇攢銆嶃€?
## GitHub 涓嶅彲杈撅紙瀹炴祴锛?
- `github.com` 鐨?git smart-http 璇锋眰鎸傚埌 180 绉掕秴鏃讹紝缃戦〉涔熸墦涓嶅紑锛堟棤 VPN锛夛紝涓変釜 npm/gitee 鍩熷悕鍒欓兘閫氥€?- 鍥犳鎻掍欢甯傚満鐨?*鑷姩鏀跺綍**锛堣姹?GitHub 浠撳簱 + `dsh-plugin` 璇濋锛変笌 OIDC 鍙俊鍙戝竷閮借蛋涓嶄簡锛?  鍒嗗彂鍙潬 Gitee 闀滃儚 + npm + 鏈湴 tgz 涓夋潯銆?- 鎻掍欢甯傚満閲屽凡鏈変竴涓?*鍚屽悕**鐨?`dsh-auto-translate`锛堜綔鑰?qwert702锛孏itHub 浠撳簱锛屸槄2锛夛紝
  璧扮殑鏄€岃皟鐢ㄦā鍨嬬炕璇戙€嶈矾绾匡紝涓庢湰鎻掍欢锛堟祻瑙堝櫒鍐?WASM銆侀浂 token锛夋槸涓ゅ涓滆タ锛屾敞鎰忓埆娣锋穯銆?
## 閲嶅惎鐨勬纭Э鍔匡紙韪╄繃鐨勫潙锛?
- 鐩存帴鐢ㄥ墠鍙?pwsh 鎴?Start-Process 璺戦噸鍚剼鏈紝鑴氭湰浼氬湪鏉€鏈嶅姟鍚庤鏉€杩炲甫姝绘帀锛堟棩蹇楀彧鍋滃湪 `script PID`锛夈€?- 鍙潬鍋氭硶锛氱敤璁″垝浠诲姟璋冪敤 `restart-guard.ps1` 鈥斺€?瀹冨彧鍦ㄣ€屾湇鍔¤繘绋嬪惎鍔ㄦ椂闂?< 鎻掍欢鏂囦欢淇敼鏃堕棿銆嶆椂鎵嶉噸鍚紝澶╃劧骞傜瓑銆?
## 鐜扮姸涓庡凡鐭ラ檺鍒?
- 璇悜锛歟n鈫抸h 鐢?fp32 骞插噣鍥撅紙绾?425MB锛夛紱ja/ko 绛夆啋zh 璧颁袱璺崇粡 en锛堢害 425MB锛夎€屼笉鏄?NLLB 5GB锛孨LLB 浠嶅彲閫夈€?- 閲忓寲鍙樹綋锛坕nt8 / uint8 / q8 / q4 / bnb4锛夊湪鏈満 ONNX Runtime 涓婁細瑙﹀彂
  `TransposeDQWeightsForMatMulNBits Missing required scale`锛屽洜姝?*鍒绘剰鍙敤 fp32**銆?- 妯″瀷 revision 宸查攣 sha锛岃 `vendor/worker.v5.js` 閲岀殑 `REVISIONS`銆?- 鍦ㄧ嚎寮曟搸 MyMemory 鏈夋瘡鏃ラ搴︼紙鍙兘 429锛夛紱绔晶 Translator 闇€杩?Google 缁勪欢鏈嶅姟鍣紙鏈綉缁滀笉鍙敤锛夈€?- 浠撳簱璺熻釜 26 涓枃浠躲€佺害 1MB锛?4MB 鐨?ORT wasm 琚?`.gitignore` 鎺掗櫎锛坄vendor/ort/*.wasm`锛夛紝
  棣栨浣跨敤鏃跺涓荤浠?CDN 鍙栧洖骞剁紦瀛橈紱瑕佸畬鍏ㄧ绾垮厛 `npm run fetch-vendor`銆?
## 涓嬩竴姝ュ€欓€?
1. jsdom 绾?E2E锛氱炕璇?鈫?鎮仠鍒囨崲 鈫?瑙傚療鑰呬笉瑕嗙洊锛堢洰鍓嶅彧鍒扮函鍑芥暟绾э級銆?2. 闈㈡澘宸蹭腑鑻卞弻璇紱README 涓庤瘖鏂枃鏈彲鍐嶇粏鍖栬嫳鏂囥€?3. 鑻ヨ璁╂彃浠跺競鍦?*鑷姩鏀跺綍**锛岃繕闇€鎶婁粨搴撴斁鍒?GitHub 骞跺姞 `dsh-plugin` 璇濋锛圙itee 涓嶅弬涓庢敹褰曪級銆?