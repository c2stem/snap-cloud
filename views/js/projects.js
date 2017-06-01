var projectIndex = $('#project-index'),
    searchbar = $('#search'),
    SEARCH_DELAY = 300,
    searchFnId;

// TODO: Add more pages

// Search for projects matching the given query after typing
searchbar.keydown(function (event) {
    if (searchFnId) {
        clearTimeout(searchFnId);
    }

    searchFnId = setTimeout(function () {
        loadProjects(0);
    }, SEARCH_DELAY);
});

function parseResponse(response) {
    var list = [];
    if (response) {
        response.split(' ').forEach(function (service) {
            var entries = service.split('&'),
                dict = {};
            entries.forEach(function (entry) {
                var pair = entry.split('='),
                    key = decodeURIComponent(pair[0]),
                    val = decodeURIComponent(pair[1]);
                dict[key] = val;
            });
            if (dict.Updated) {
                dict.Updated = new Date(dict.Updated);
            }
            list.push(dict);
        });
    }
    return list;
}

function loadProjects(page) {
    // Get the search filter
    var searchFilter = searchbar.val();

    try {
        page = typeof page === 'number' ? +page : 0;
        var request = new XMLHttpRequest(),
            url;

        url = '/SnapCloud/PublicProjects?page=' + page;
        if (searchFilter) {
            url += '&search=' + encodeURIComponent(searchFilter);
        }
        request.open('GET', url, true);
        request.withCredentials = true;
        request.onreadystatechange = function () {
            if (request.readyState === 4) {
                if (request.status === 200) {
                    updateProjectList(parseResponse(request.responseText));
                } else {
                    reportError(request.responseText || 'Connection refused');
                }
            }
        };
        request.send();
    } catch (err) {
        reportError('Could not connect to SnapCloud');
    }
}

function reportError(error) {
    Materialize.toast('Error: ' + error);
}

function updateProjectList(projects) {
    projectIndex.empty();
    var cards = projects.map(project => {
        var url = project.Origin + '/snap.html#present:' +
            'Username=' + encodeURIComponent(project.User) +
            '&ProjectName=' + encodeURIComponent(project.ProjectName) +
            '&editMode&noRun';
        var metadata = 'created by ' + project.User;

        if (project.Updated) {
            metadata += ' at ' + project.Updated.getFullYear() + '/' +
                (project.Updated.getMonth() + 1) + '/' +
                project.Updated.getDate();
        }
        metadata += '\n' + (project.Origin || '');

        return `
          <div class="col s12 m3 l2">
            <div class="card project-card">
              <div class="card-image waves-effect waves-block waves-light project-thumbnail" data-url="${url}">
                <img class="activator" src="${project.Thumbnail}" title="${metadata}">
              </div>
              <div class="card-content">
                  <span title="${project.ProjectName}" class="card-title project-title activator grey-text text-darken-4 truncate">${project.ProjectName}<br/><i class="material-icons right">more_vert</i></span>
                <p><a href="${url}"></a></p>
              </div>
              <div class="card-reveal">
                  <span class="card-title project-title grey-text text-darken-4 truncate">${project.ProjectName}<i class="material-icons right">close</i></span>
                  <p>${project.Notes || '<i>no project notes</i>'}</p>
              </div>
            </div>
          </div>`;
    });

    // Add each of the cards to the columns
    projectIndex.append('<div class="row">' + cards.join('') + '</div>');

    // Click the card for opening the url
    $('.project-thumbnail').on('click', function (event) {
        var element = event.currentTarget,
            url = element.getAttribute('data-url');

        window.location = url;
    });
}

window.onload = function () {
    loadProjects(0);
};
